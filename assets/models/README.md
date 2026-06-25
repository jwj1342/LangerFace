# LangerFace Model Assets

This directory contains runtime model assets that are intentionally versioned with
the repository.

## `wrinkle_unet_patient_finetuned.pth`

Fine-tuned FFHQ-Wrinkle U-Net checkpoint used by
`tools/predict_wrinkle_unet.py` to predict a patient-specific wrinkle mask. The
mask gates the Hessian wrinkle direction field used by texture-guided local
warping.

Training summary:

- Base checkpoint: `stage2_wrinkle_finetune_unet/stage2_unet.pth` from the
  local FFHQ-Wrinkle pretrained checkpoint bundle.
- Dataset root: `local_archives/datasets/ffhq_wrinkle`.
- Supervision: `manual_wrinkle_masks/`.
- Texture input: weak wrinkle masks read from
  `local_archives/datasets/FFHQ_archives/complete/weak-wrinkle-masks-002.zip`.
- Input size: `512`.
- Train/validation split: `850 / 150`.
- Best validation Dice: `0.6304`.

Usage:

```powershell
D:\miniconda\envs\vggt\python.exe tools/predict_wrinkle_unet.py `
  --checkpoint assets/models/wrinkle_unet_patient_finetuned.pth `
  --input patient.png `
  --out local_outputs/wrinkle_masks
```

Licensing note: FFHQ-Wrinkle is documented by its local repository as
CC BY-NC-SA 4.0. This checkpoint is included for research/demo use in the same
non-commercial context and is not a clinical decision-making device.
