# V10 wrinkle provider deployment

The production browser must use this service for the same dynamic four-region
V10 result as the local Vite bridge. It must not fall back to the legacy
browser detector when this service is unavailable.

## Architecture

1. The browser calls the same-origin `/api/wrinkle-v10` ticket endpoint. This
   request contains no image and stays well below Vercel's Function body limit.
2. The Vercel function checks `/health` and returns a 90-second, origin-bound,
   single-use ticket plus the direct provider URL.
3. The browser sends the unchanged binary RGBA request directly to this service,
   with a 32 MB application guard. The image never enters a Vercel Function.
4. This container runs the repository's `run_live_four_region_wrinkle.py --serve`
   process with the tracked V10 checkpoint.

The provider health response is validated against detector version
`paired-edge-v10-dynamic-four-region-1.0` before an image is processed.

## Render deployment

1. Create the service from the repository's root `render.yaml` Blueprint.
2. Keep the generated `WRINKLE_V10_SERVICE_TOKEN` and
   `WRINKLE_V10_TICKET_SECRET` secret. Set `WRINKLE_V10_ALLOWED_ORIGINS` to the
   exact protected Vercel production/preview origins that may call the provider.
3. Copy the deployed service URL and ticket secret into the Vercel project environment:

   - `WRINKLE_V10_SERVICE_URL=https://<render-service-host>`
   - `WRINKLE_V10_TICKET_SECRET=<same generated ticket secret>`
   - `WRINKLE_V10_ALLOWED_ORIGINS=https://<protected-web-host>`

4. Enable Vercel Deployment Protection (team authentication or password) for
   every deployment that can mint V10 tickets. Do not expose an anonymous
   ticket endpoint for patient-image workflows.
5. Redeploy the Vercel web project with `web` as its root directory.
6. Verify `GET https://<web-host>/api/wrinkle-v10` returns:

   - `schemaVersion: langerface.wrinkle-v10-provider.v1`
   - `detectorVersion: paired-edge-v10-dynamic-four-region-1.0`
   - `checkpointSha256: e301b8f70c8239c01504a0616b61acdf9ab9b5796f513d6e7294d4fa52b6a6c2`
   - `processingLocation: remote_service`
   - `ready: true`
   - `directDetectUrl: https://<render-service-host>/v1/detect`
   - a short-lived `accessToken` and `maximumRequestBytes: 33554432`

The Render service needs enough memory to load PyTorch and the 66 MB checkpoint.
The current service intentionally allows one inference at a time and returns
HTTP 429 for concurrent requests. Browser tickets are origin-bound, single-use,
and limited to six requests per signed caller per minute. Requests are cancelled
after 45 seconds or client disconnect, and temporary pixel/request files are
removed after each response.
