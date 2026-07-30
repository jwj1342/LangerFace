# Personalized Texture Warping

Bottom-up texture warping refines the 3D/RSTL prior with patient-specific fine wrinkles visible in the input image.

## Runtime Path

The production runtime stays dependency-light:

1. `LinePipeline.process(..., wrinkle_mask=None)` detects the face and maps the atlas prior as before.
2. When `Config.texture_warp.enabled` is true, `HessianWrinkleExtractor` builds a dense wrinkle tangent field from the patient image.
3. If a predicted wrinkle mask is supplied, it gates the Hessian field strength.
4. `warp_mapped_lines` searches along each prior line normal for a nearby wrinkle ridge whose tangent agrees with the prior tangent, then applies a bounded local pixel shift.

The feature is disabled by default to preserve baseline behavior.

```powershell
langerface --image patient.png --system rstl -o out.png --texture-warp
```

With a model-predicted mask:

```powershell
D:\miniconda\envs\vggt\python.exe tools/predict_wrinkle_unet.py --checkpoint assets/models/wrinkle_unet_patient_finetuned.pth --input patient.png
langerface --image patient.png --system rstl -o out.png --texture-warp --wrinkle-mask local_outputs/wrinkle_masks/patient_wrinkle_mask.png
```

## FFHQ-Wrinkle Training

Local data is expected under:

```text
local_archives/datasets/ffhq_wrinkle/
  images1024x1024/
  manual_wrinkle_masks/
```

The official FFHQ-Wrinkle U-Net uses RGB plus a grayscale texture channel. The
fine-tuning script supervises on `manual_wrinkle_masks/` and reads texture maps
on demand from the large weak-mask zip, so the weak labels do not need to be
fully extracted:

```powershell
D:\miniconda\envs\vggt\python.exe tools/finetune_wrinkle_unet.py `
  --dataset local_archives/datasets/ffhq_wrinkle `
  --weak-zip local_archives/datasets/FFHQ_archives/complete/weak-wrinkle-masks-002.zip `
  --pretrained local_archives/pretrained_ckpt/stage2_wrinkle_finetune_unet/stage2_unet.pth `
  --out local_outputs/wrinkle_unet_patient_finetuned.pth `
  --epochs 5 --batch-size 2 --img-size 512 --lr 1e-5 --amp
```

Current local fine-tune result:

```text
assets/models/wrinkle_unet_patient_finetuned.pth
architecture=FFHQWrinkleUNet
imgSize=512
trainSamples=850
valSamples=150
bestValDice=0.6304
```

If only `images1024x1024` exists, training exits with a clear diagnostic because wrinkle masks are required as labels. The Hessian runtime path still works without labels or a trained model.

## License Boundary

FFHQ-Wrinkle is documented by its local repository as CC BY-NC-SA 4.0. Keep downloaded datasets, checkpoints, and generated masks in `local_archives/` or `local_outputs/`; do not commit them unless the project license decision explicitly allows it.
