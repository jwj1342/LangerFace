FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLCONFIGDIR=/tmp/langerface-matplotlib

WORKDIR /app

COPY deploy/wrinkle_v10/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY assets/models/wrinkle_unet_patient_finetuned.pth assets/models/wrinkle_unet_patient_finetuned.pth
COPY tools tools
COPY deploy deploy

RUN useradd --create-home --uid 10001 langerface && chown -R langerface:langerface /app
USER langerface

EXPOSE 8000
CMD ["uvicorn", "deploy.wrinkle_v10.service:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
