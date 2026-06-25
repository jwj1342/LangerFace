"""Train a lightweight wrinkle edge detector on local FFHQ-Wrinkle data.

This script is intentionally optional: the core LangerFace package does not
depend on PyTorch. It expects a dataset root shaped like FFHQ-Wrinkle:

  images1024x1024/<bucket>/<id>.png
  manual_wrinkle_masks/<id>.png       # preferred when present
  weak_wrinkle_masks/<bucket>/<id>.png or weak_wrinkle_masks/<id>.png

The saved checkpoint can be used with ``tools/predict_wrinkle_masks.py`` to
produce a mask, then passed to the CLI with ``--texture-warp --wrinkle-mask``.
"""
from __future__ import annotations

import argparse
import random
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = REPO / "local_archives" / "datasets" / "ffhq_wrinkle"
DEFAULT_OUT = REPO / "local_outputs" / "wrinkle_edge_model.pth"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


@dataclass(frozen=True)
class Sample:
    image: Path
    mask: Path


def main() -> int:
    args = _parse_args()
    try:
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
        from torch.utils.data import DataLoader, Dataset
    except ImportError as exc:
        raise SystemExit(
            "PyTorch is required for training. Install the optional FFHQ-Wrinkle training "
            "environment first, for example from local_archives/datasets/ffhq_wrinkle_repo/requirements.txt"
        ) from exc

    samples = collect_samples(args.dataset, args.label_source)
    if not samples:
        raise SystemExit(
            f"No paired images/masks found under {args.dataset}. Expected images1024x1024 plus "
            "manual_wrinkle_masks or weak_wrinkle_masks. Your current local dataset appears to "
            "contain FFHQ images only; download or unpack the wrinkle masks beside them."
        )
    if args.max_samples:
        samples = samples[: args.max_samples]
    random.Random(args.seed).shuffle(samples)
    val_count = max(1, int(len(samples) * args.val_fraction)) if len(samples) > 4 else 0
    val_samples = samples[:val_count]
    train_samples = samples[val_count:] or samples

    class WrinkleDataset(Dataset):
        def __init__(self, items: list[Sample]):
            self.items = items

        def __len__(self):
            return len(self.items)

        def __getitem__(self, idx):
            item = self.items[idx]
            image = cv2.imread(str(item.image), cv2.IMREAD_COLOR)
            mask = cv2.imread(str(item.mask), cv2.IMREAD_GRAYSCALE)
            if image is None or mask is None:
                raise FileNotFoundError(f"Unreadable sample: {item}")
            image = cv2.resize(image, (args.img_size, args.img_size), interpolation=cv2.INTER_AREA)
            mask = cv2.resize(mask, (args.img_size, args.img_size), interpolation=cv2.INTER_NEAREST)
            image = image[:, :, ::-1].astype(np.float32) / 255.0
            mask = (mask.astype(np.float32) > args.mask_threshold).astype(np.float32)
            image = np.transpose(image, (2, 0, 1))
            return torch.from_numpy(image), torch.from_numpy(mask[None, :, :])

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    model = make_tiny_dexined(nn, F, torch).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    train_loader = DataLoader(
        WrinkleDataset(train_samples),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(WrinkleDataset(val_samples), batch_size=args.batch_size) if val_samples else None

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        for image, mask in train_loader:
            image = image.to(device)
            mask = mask.to(device)
            logits = model(image)
            loss = sum(edge_loss(logit, mask, F) for logit in logits) / len(logits)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            train_loss += float(loss.detach().cpu())
        train_loss /= max(1, len(train_loader))
        val_loss = evaluate(model, val_loader, device, F) if val_loader else 0.0
        print(f"epoch={epoch:03d} train_loss={train_loss:.4f} val_loss={val_loss:.4f}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": model.state_dict(),
            "architecture": "TinyDexiNed",
            "imgSize": args.img_size,
            "labelSource": args.label_source,
            "dataset": str(args.dataset),
        },
        args.out,
    )
    print(f"[ok] saved {args.out} train_samples={len(train_samples)} val_samples={len(val_samples)}")
    return 0


def collect_samples(dataset: Path, label_source: str) -> list[Sample]:
    image_root = dataset / "images1024x1024"
    if not image_root.exists():
        return []
    mask_roots = []
    if label_source in {"manual", "auto"}:
        mask_roots.append(dataset / "manual_wrinkle_masks")
    if label_source in {"weak", "auto"}:
        mask_roots.append(dataset / "weak_wrinkle_masks")

    mask_by_name: dict[str, Path] = {}
    for root in mask_roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
                mask_by_name.setdefault(path.name, path)
                mask_by_name.setdefault(path.stem, path)

    samples = []
    for image in image_root.rglob("*"):
        if not image.is_file() or image.suffix.lower() not in IMAGE_EXTS:
            continue
        mask = mask_by_name.get(image.name) or mask_by_name.get(image.stem)
        if mask:
            samples.append(Sample(image=image, mask=mask))
    return sorted(samples, key=lambda s: str(s.image))


def evaluate(model, loader, device, F) -> float:
    if loader is None:
        return 0.0
    import torch

    model.eval()
    total = 0.0
    with torch.inference_mode():
        for image, mask in loader:
            image = image.to(device)
            mask = mask.to(device)
            logits = model(image)
            total += float(edge_loss(logits[-1], mask, F).detach().cpu())
    return total / max(1, len(loader))


def edge_loss(logit, mask, F):
    import torch

    bce = F.binary_cross_entropy_with_logits(logit, mask)
    prob = torch.sigmoid(logit)
    inter = (prob * mask).sum(dim=(1, 2, 3))
    denom = prob.sum(dim=(1, 2, 3)) + mask.sum(dim=(1, 2, 3)) + 1e-6
    dice = 1.0 - torch.mean((2.0 * inter + 1e-6) / denom)
    return bce + dice


def make_tiny_dexined(nn, F, torch):
    class _Block(nn.Module):
        def __init__(self, in_ch: int, out_ch: int):
            super().__init__()
            self.net = nn.Sequential(
                nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
                nn.BatchNorm2d(out_ch),
                nn.ReLU(inplace=True),
                nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
                nn.BatchNorm2d(out_ch),
                nn.ReLU(inplace=True),
            )

        def forward(self, x):
            return self.net(x)

    class TinyDexiNed(nn.Module):
        """Small multi-scale side-output edge network inspired by DexiNed."""

        def __init__(self):
            super().__init__()
            self.b1 = _Block(3, 24)
            self.b2 = _Block(24, 48)
            self.b3 = _Block(48, 96)
            self.pool = nn.MaxPool2d(2)
            self.side1 = nn.Conv2d(24, 1, 1)
            self.side2 = nn.Conv2d(48, 1, 1)
            self.side3 = nn.Conv2d(96, 1, 1)
            self.fuse = nn.Conv2d(3, 1, 1)

        def forward(self, x):
            x1 = self.b1(x)
            x2 = self.b2(self.pool(x1))
            x3 = self.b3(self.pool(x2))
            s1 = self.side1(x1)
            s2 = F.interpolate(self.side2(x2), size=x.shape[-2:], mode="bilinear", align_corners=False)
            s3 = F.interpolate(self.side3(x3), size=x.shape[-2:], mode="bilinear", align_corners=False)
            fused = self.fuse(torch.cat([s1, s2, s3], dim=1))
            return [s1, s2, s3, fused]

    return TinyDexiNed()


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--label-source", choices=["auto", "manual", "weak"], default="auto")
    ap.add_argument("--img-size", type=int, default=256)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--workers", type=int, default=0)
    ap.add_argument("--max-samples", type=int, default=0)
    ap.add_argument("--val-fraction", type=float, default=0.1)
    ap.add_argument("--mask-threshold", type=float, default=8.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--cpu", action="store_true")
    return ap.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
