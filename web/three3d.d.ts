export function vertexNormals(
  verts: Array<[number, number, number]>,
  tris: Array<[number, number, number]>,
): Array<[number, number, number]>;

export function buildLineGeometry(
  atlasLines: Array<{
    points?: Array<[number, number, number]>;
    points3d?: Array<[number, number, number]>;
  }>,
  verts: Array<[number, number, number]>,
  tris: Array<[number, number, number]>,
  normals: Array<[number, number, number]>,
  bands?: boolean,
): import("three").BufferGeometry;
