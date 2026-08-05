import id001Compare from "../../../compat/personalized/v6_demo/id_001/rstl_before_after.jpg?url";
import id001Zoom from "../../../compat/personalized/v6_demo/id_001/rstl_visible_change_zoom_4x.jpg?url";
import id001Match from "../../../compat/personalized/v6_demo/id_001/wrinkle_rstl_correspondence.jpg?url";
import id001Heatmap from "../../../compat/personalized/v6_demo/id_001/rstl_displacement_heatmap.jpg?url";
import id003Compare from "../../../compat/personalized/v6_demo/id_003/rstl_before_after.jpg?url";
import id003Zoom from "../../../compat/personalized/v6_demo/id_003/rstl_visible_change_zoom_4x.jpg?url";
import id003Match from "../../../compat/personalized/v6_demo/id_003/wrinkle_rstl_correspondence.jpg?url";
import id003Heatmap from "../../../compat/personalized/v6_demo/id_003/rstl_displacement_heatmap.jpg?url";
import id004Compare from "../../../compat/personalized/v6_demo/id_004/rstl_before_after.jpg?url";
import id004Zoom from "../../../compat/personalized/v6_demo/id_004/rstl_visible_change_zoom_4x.jpg?url";
import id004Match from "../../../compat/personalized/v6_demo/id_004/wrinkle_rstl_correspondence.jpg?url";
import id004Heatmap from "../../../compat/personalized/v6_demo/id_004/rstl_displacement_heatmap.jpg?url";
import id005Compare from "../../../compat/personalized/v6_demo/id_005/rstl_before_after.jpg?url";
import id005Zoom from "../../../compat/personalized/v6_demo/id_005/rstl_visible_change_zoom_4x.jpg?url";
import id005Match from "../../../compat/personalized/v6_demo/id_005/wrinkle_rstl_correspondence.jpg?url";
import id005Heatmap from "../../../compat/personalized/v6_demo/id_005/rstl_displacement_heatmap.jpg?url";
import id006Compare from "../../../compat/personalized/v6_demo/id_006/rstl_before_after.jpg?url";
import id006Zoom from "../../../compat/personalized/v6_demo/id_006/rstl_visible_change_zoom_4x.jpg?url";
import id006Match from "../../../compat/personalized/v6_demo/id_006/wrinkle_rstl_correspondence.jpg?url";
import id006Heatmap from "../../../compat/personalized/v6_demo/id_006/rstl_displacement_heatmap.jpg?url";

export interface V6DemoMetrics {
  movedCurves: number;
  movedPoints: number;
  p90Before: number;
  p90After: number;
  p90Limit: number;
  softLink: number;
  distanceGain: number;
  directionGain: number;
}

export type V6DemoView = "compare" | "zoom" | "match" | "heatmap";

export type V6DemoImages = Record<V6DemoView, string>;

export interface V6DemoResult {
  id: string;
  metrics: V6DemoMetrics;
  images: V6DemoImages;
}

const result = (id: string, metrics: V6DemoMetrics, images: V6DemoImages): V6DemoResult => ({
  id,
  metrics,
  images,
});

export const V6_DEMO_RESULTS: readonly V6DemoResult[] = [
  result("001", { movedCurves: 4, movedPoints: 188, p90Before: 4.92, p90After: 4.17, p90Limit: 4.17, softLink: 7.75, distanceGain: 1.17, directionGain: -0.27 },
    { compare: id001Compare, zoom: id001Zoom, match: id001Match, heatmap: id001Heatmap }),
  result("003", { movedCurves: 7, movedPoints: 395, p90Before: 7.71, p90After: 4.12, p90Limit: 4.17, softLink: 7.74, distanceGain: 2.13, directionGain: 0.51 },
    { compare: id003Compare, zoom: id003Zoom, match: id003Match, heatmap: id003Heatmap }),
  result("004", { movedCurves: 4, movedPoints: 163, p90Before: 6.73, p90After: 4.11, p90Limit: 4.23, softLink: 7.86, distanceGain: 0.91, directionGain: 0.41 },
    { compare: id004Compare, zoom: id004Zoom, match: id004Match, heatmap: id004Heatmap }),
  result("005", { movedCurves: 13, movedPoints: 297, p90Before: 6.49, p90After: 3.87, p90Limit: 4.18, softLink: 7.75, distanceGain: 1.26, directionGain: 0.69 },
    { compare: id005Compare, zoom: id005Zoom, match: id005Match, heatmap: id005Heatmap }),
  result("006", { movedCurves: 9, movedPoints: 360, p90Before: 5.38, p90After: 3.93, p90Limit: 3.94, softLink: 7.32, distanceGain: 1.23, directionGain: 0.16 },
    { compare: id006Compare, zoom: id006Zoom, match: id006Match, heatmap: id006Heatmap }),
];

export const V6_VIEW_LABELS: Readonly<Record<V6DemoView, string>> = {
  compare: "完整前后对比",
  zoom: "4× 局部变化",
  match: "皱纹—RSTL 对应",
  heatmap: "位移热图",
};
