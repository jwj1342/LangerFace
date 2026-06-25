"""Fine-tune the FFHQ-Wrinkle U-Net checkpoint for patient wrinkle masks.

The official FFHQ-Wrinkle U-Net consumes four channels: RGB plus a grayscale
texture map. During fine-tuning we supervise with manual wrinkle masks and read
the weak texture map directly from the large weak-mask zip, avoiding a full
7GB extraction step.
"""
from __future__ import annotations

import argparse
import io
import random
import sys
from dataclasses import dataclass
from pathlib import Path
from zipfile import ZipFile

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = REPO / "local_archives" / "datasets" / "ffhq_wrinkle"
DEFAULT_WEAK_ZIP = (
    REPO / "local_archives" / "datasets" / "FFHQ_archives" / "complete" / "weak-wrinkle-masks-002.zip"
)
DEFAULT_PRETRAINED = (
    REPO / "local_archives" / "pretrained_ckpt" / "stage2_wrinkle_finetune_unet" / "stage2_unet.pth"
)
DEFAULT_OUT = REPO / "local_outputs" / "wrinkle_unet_patient_finetuned.pth"


@dataclass(frozen=True)
class Sample:
    image: Path
    mask: Path
    image_id: str


def main() -> int:
    args = _parse_args()
    try:
        import torch
        import torch.nn.functional as F
        from torch.utils.data import DataLoader, Dataset
    except ImportError as exc:
        raise SystemExit("PyTorch is required. Run with a torch-enabled environment, e.g. nextface.") from exc

    sys.path.insert(0, str(REPO / "local_archives" / "datasets" / "ffhq_wrinkle_repo"))
    from unet.unet_model import UNet

    samples = collect_manual_samples(args.dataset)
    if args.max_samples:
        samples = samples[: args.max_samples]
    if not samples:
        raise SystemExit(f"No manual wrinkle samples found under {args.dataset}")
    random.Random(args.seed).shuffle(samples)
    val_count = max(1, int(len(samples) * args.val_fraction)) if len(samples) > 8 else 0
    val_samples = samples[:val_count]
    train_samples = samples[val_count:] or samples

    class WrinkleUNetDataset(Dataset):
        def __init__(self, items: list[Sample], train: bool):
            self.items = items
            self.train = train
            self._weak_zip = None
            self._weak_names = None

        def __len__(self):
            return len(self.items)

        def __getitem__(self, idx):
            item = self.items[idx]
            image = cv2.imread(str(item.image), cv2.IMREAD_COLOR)
            mask = cv2.imread(str(item.mask), cv2.IMREAD_GRAYSCALE)
            if image is None or mask is None:
                raise FileNotFoundError(f"Unreadable sample: {item}")
            texture = self._read_weak_texture(item.image_id)
            if texture is None:
                texture = hessian_texture(image)

            image = cv2.resize(image, (args.img_size, args.img_size), interpolation=cv2.INTER_AREA)
            mask = cv2.resize(mask, (args.img_size, args.img_size), interpolation=cv2.INTER_NEAREST)
            texture = cv2.resize(texture, (args.img_size, args.img_size), interpolation=cv2.INTER_AREA)

            if self.train and random.random() < 0.5:
                image = np.ascontiguousarray(image[:, ::-1])
                mask = np.ascontiguousarray(mask[:, ::-1])
                texture = np.ascontiguousarray(texture[:, ::-1])

            rgb = image[:, :, ::-1].astype(np.float32) / 255.0
            tex = texture.astype(np.float32) / 255.0
            rgb = rgb * 2.0 - 1.0
            tex = tex * 2.0 - 1.0
            x = np.concatenate([np.transpose(rgb, (2, 0, 1)), tex[None]], axis=0)
            y = (mask.astype(np.float32) > args.mask_threshold).astype(np.int64)
            return torch.from_numpy(x), torch.from_numpy(y)

        def _read_weak_texture(self, image_id: str) -> np.ndarray | None:
            if not args.weak_zip.exists():
                return None
            if self._weak_zip is None:
                self._weak_zip = ZipFile(args.weak_zip)
                self._weak_names = set(self._weak_zip.namelist())
            bucket = f"{(int(image_id) // 1000) * 1000:05d}"
            member = f"weak_wrinkle_masks/{bucket}/{image_id}.png"
            if member not in self._weak_names:
                return None
            data = self._weak_zip.read(member)
            return np.asarray(Image.open(io.BytesIO(data)).convert("L"))

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    model = UNet(n_channels=4, n_classes=2, bilinear=True).to(device)
    if args.pretrained:
        load_checkpoint(model, args.pretrained, torch, device)
        print(f"[ok] loaded pretrained {args.pretrained}")

    train_loader = DataLoader(
        WrinkleUNetDataset(train_samples, train=True),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(
        WrinkleUNetDataset(val_samples, train=False),
        batch_size=args.batch_size,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
    ) if val_samples else None

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scaler = torch.amp.GradScaler("cuda", enabled=args.amp and device.type == "cuda")
    best_dice = -1.0
    best_state = None
    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for x, y in train_loader:
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=args.amp and device.type == "cuda"):
                logits = model(x)
                loss = segmentation_loss(logits, y, F)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            total_loss += float(loss.detach().cpu())
        train_loss = total_loss / max(1, len(train_loader))
        val = evaluate(model, val_loader, device, F, torch) if val_loader else {"loss": 0.0, "dice": 0.0}
        print(
            f"epoch={epoch:03d} train_loss={train_loss:.4f} "
            f"val_loss={val['loss']:.4f} val_dice={val['dice']:.4f}"
        )
        if val["dice"] >= best_dice:
            best_dice = val["dice"]
            best_state = {k: v.detach().cpu() for k, v in model.state_dict().items()}

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": best_state or model.state_dict(),
            "architecture": "FFHQWrinkleUNet",
            "inputChannels": 4,
            "classes": 2,
            "imgSize": args.img_size,
            "pretrained": str(args.pretrained),
            "weakZip": str(args.weak_zip),
            "dataset": str(args.dataset),
            "trainSamples": len(train_samples),
            "valSamples": len(val_samples),
            "bestValDice": float(best_dice),
        },
        args.out,
    )
    print(f"[ok] saved {args.out} best_val_dice={best_dice:.4f}")
    return 0


def collect_manual_samples(dataset: Path) -> list[Sample]:
    image_root = dataset / "images1024x1024"
    mask_root = dataset / "manual_wrinkle_masks"
    if not image_root.exists() or not mask_root.exists():
        return []
    samples = []
    for mask in sorted(mask_root.glob("*.png")):
        image_id = mask.stem
        bucket = f"{(int(image_id) // 1000) * 1000:05d}"
        image = image_root / bucket / f"{image_id}.png"
        if image.exists():
            samples.append(Sample(image=image, mask=mask, image_id=image_id))
    return samples


def load_checkpoint(model, path: Path, torch, device) -> None:
    checkpoint = torch.load(path, map_location=device)
    state_dict = checkpoint.get("model", checkpoint) if isinstance(checkpoint, dict) else checkpoint
    clean = {k.removeprefix("module."): v for k, v in state_dict.items()}
    model.load_state_dict(clean, strict=True)


def segmentation_loss(logits, target, F):
    ce = F.cross_entropy(logits, target)
    prob = F.softmax(logits, dim=1)[:, 1]
    truth = target.float()
    inter = (prob * truth).sum(dim=(1, 2))
    denom = prob.sum(dim=(1, 2)) + truth.sum(dim=(1, 2)) + 1e-6
    dice = 1.0 - ((2.0 * inter + 1e-6) / denom).mean()
    return ce + dice


def evaluate(model, loader, device, F, torch) -> dict[str, float]:
    model.eval()
    total_loss = 0.0
    total_inter = 0.0
    total_denom = 0.0
    with torch.inference_mode():
        for x, y in loader:
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)
            logits = model(x)
            total_loss += float(segmentation_loss(logits, y, F).detach().cpu())
            pred = F.softmax(logits, dim=1)[:, 1]
            truth = y.float()
            total_inter += float((pred * truth).sum().detach().cpu())
            total_denom += float((pred.sum() + truth.sum()).detach().cpu())
    dice = (2.0 * total_inter + 1e-6) / (total_denom + 1e-6)
    return {"loss": total_loss / max(1, len(loader)), "dice": dice}


def hessian_texture(image_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    smooth = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.2, sigmaY=1.2)
    ixx = cv2.Sobel(smooth, cv2.CV_32F, 2, 0, ksize=3)
    ixy = cv2.Sobel(smooth, cv2.CV_32F, 1, 1, ksize=3)
    iyy = cv2.Sobel(smooth, cv2.CV_32F, 0, 2, ksize=3)
    trace = ixx + iyy
    delta = np.sqrt(np.maximum((ixx - iyy) ** 2 + 4.0 * ixy * ixy, 0.0))
    strength = np.maximum(np.abs(0.5 * (trace + delta)), np.abs(0.5 * (trace - delta)))
    positive = strength[strength > 0]
    if positive.size:
        strength = np.clip(strength / max(float(np.percentile(positive, 98)), 1e-6), 0.0, 1.0)
    return (strength * 255.0).astype(np.uint8)


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    ap.add_argument("--weak-zip", type=Path, default=DEFAULT_WEAK_ZIP)
    ap.add_argument("--pretrained", type=Path, default=DEFAULT_PRETRAINED)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--img-size", type=int, default=512)
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--batch-size", type=int, default=2)
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--workers", type=int, default=0)
    ap.add_argument("--max-samples", type=int, default=0)
    ap.add_argument("--val-fraction", type=float, default=0.15)
    ap.add_argument("--mask-threshold", type=float, default=8.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--amp", action="store_true")
    ap.add_argument("--cpu", action="store_true")
    return ap.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
