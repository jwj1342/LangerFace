"""Predict patient wrinkle masks with a fine-tuned FFHQ-Wrinkle U-Net."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

from finetune_wrinkle_unet import hessian_texture

REPO = Path(__file__).resolve().parents[1]
DEFAULT_CHECKPOINT = REPO / "assets" / "models" / "wrinkle_unet_patient_finetuned.pth"


def main() -> int:
    args = _parse_args()
    try:
        import torch
        import torch.nn.functional as F
    except ImportError as exc:
        raise SystemExit("PyTorch is required. Run with a torch-enabled environment, e.g. nextface.") from exc

    sys.path.insert(0, str(REPO / "local_archives" / "datasets" / "ffhq_wrinkle_repo"))
    from unet.unet_model import UNet

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    checkpoint = torch.load(args.checkpoint, map_location=device)
    img_size = int(checkpoint.get("imgSize", args.img_size))
    model = UNet(n_channels=4, n_classes=2, bilinear=True).to(device)
    state = checkpoint.get("model", checkpoint)
    model.load_state_dict({k.removeprefix("module."): v for k, v in state.items()}, strict=True)
    model.eval()

    files = input_files(args.input)
    args.out.mkdir(parents=True, exist_ok=True)
    with torch.inference_mode():
        for path in files:
            image = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if image is None:
                print(f"[skip] unreadable {path}")
                continue
            texture = load_texture(args.texture, image, path)
            x = make_input(image, texture, img_size)
            logits = model(torch.from_numpy(x[None]).to(device))
            prob = F.softmax(logits, dim=1)[0, 1].detach().cpu().numpy()
            prob = cv2.resize(prob, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_LINEAR)
            mask = (prob >= args.threshold).astype(np.uint8) * 255
            out_path = args.out / f"{path.stem}_wrinkle_mask.png"
            cv2.imwrite(str(out_path), mask)
            if args.save_prob:
                prob_img = np.clip(prob * 255.0, 0, 255).astype(np.uint8)
                cv2.imwrite(str(args.out / f"{path.stem}_wrinkle_prob.png"), prob_img)
            print(f"[ok] {out_path}")
    return 0


def make_input(image_bgr: np.ndarray, texture: np.ndarray, img_size: int) -> np.ndarray:
    image = cv2.resize(image_bgr, (img_size, img_size), interpolation=cv2.INTER_AREA)
    tex = cv2.resize(texture, (img_size, img_size), interpolation=cv2.INTER_AREA)
    rgb = image[:, :, ::-1].astype(np.float32) / 255.0
    tex = tex.astype(np.float32) / 255.0
    rgb = rgb * 2.0 - 1.0
    tex = tex * 2.0 - 1.0
    return np.concatenate([np.transpose(rgb, (2, 0, 1)), tex[None]], axis=0).astype(np.float32)


def load_texture(texture_arg: Path | None, image_bgr: np.ndarray, image_path: Path) -> np.ndarray:
    if texture_arg is None:
        return hessian_texture(image_bgr)
    texture_path = texture_arg / image_path.name if texture_arg.is_dir() else texture_arg
    tex = cv2.imread(str(texture_path), cv2.IMREAD_GRAYSCALE)
    if tex is None:
        return hessian_texture(image_bgr)
    return tex


def input_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        exts = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
        return sorted(p for p in path.rglob("*") if p.is_file() and p.suffix.lower() in exts)
    raise FileNotFoundError(path)


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--texture", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=REPO / "local_outputs" / "wrinkle_masks")
    ap.add_argument("--img-size", type=int, default=512)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--save-prob", action="store_true")
    ap.add_argument("--cpu", action="store_true")
    return ap.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
