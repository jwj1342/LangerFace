import type { Triangle, Vec3 } from "./softBody";

export interface ParsedMesh {
  vertices: Vec3[];
  triangles: Triangle[];
  colors: Vec3[] | null;
}

interface PlyScalarProperty {
  kind: "scalar";
  type: string;
  name: string;
}

interface PlyListProperty {
  kind: "list";
  countType: string;
  itemType: string;
  name: string;
}

type PlyProperty = PlyScalarProperty | PlyListProperty;

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

interface PlyHeader {
  format: string;
  elements: PlyElement[];
}

const TEXT_DECODER = new TextDecoder("utf-8");

const SCALAR_BYTES: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

const MAX_MESH_BYTES = 200 * 1024 * 1024;
const MAX_PLY_ELEMENTS = 50_000_000;

function assertMesh(vertices: unknown, triangles: unknown, source: string, colors: unknown = null): ParsedMesh {
  if (!Array.isArray(vertices) || !Array.isArray(triangles)) {
    throw new Error(`${source} must contain vertices and triangles`);
  }
  const cleanVertices = vertices.map((vertex, index): Vec3 => {
    if (!Array.isArray(vertex) || vertex.length < 3) throw new Error(`Invalid vertex at index ${index}`);
    const point: Vec3 = [Number(vertex[0]), Number(vertex[1]), Number(vertex[2])];
    if (!point.every(Number.isFinite)) throw new Error(`Invalid vertex coordinates at index ${index}`);
    return point;
  });
  const cleanTriangles = triangles.map((face, index): Triangle => {
    if (!Array.isArray(face) || face.length < 3) throw new Error(`Invalid face at index ${index}`);
    const tri = [Number(face[0]), Number(face[1]), Number(face[2])].map((value) => Math.trunc(value)) as Triangle;
    if (!tri.every((value) => Number.isInteger(value) && value >= 0 && value < cleanVertices.length)) {
      throw new Error(`Face ${index} references a vertex outside the mesh`);
    }
    return tri;
  });
  if (!cleanVertices.length || !cleanTriangles.length) {
    throw new Error(`${source} has ${cleanVertices.length} vertices and ${cleanTriangles.length} triangles`);
  }
  let cleanColors: Vec3[] | null = null;
  if (Array.isArray(colors) && colors.length === cleanVertices.length) {
    cleanColors = colors.map((color, index): Vec3 => {
      if (!Array.isArray(color) || color.length < 3) throw new Error(`Invalid vertex color at index ${index}`);
      const rgb: Vec3 = [Number(color[0]), Number(color[1]), Number(color[2])];
      if (!rgb.every(Number.isFinite)) throw new Error(`Invalid vertex color at index ${index}`);
      return rgb.map((value) => Math.max(0, Math.min(1, value > 1 ? value / 255 : value))) as Vec3;
    });
  }
  return { vertices: cleanVertices, triangles: cleanTriangles, colors: cleanColors };
}

function triangulate(indices: unknown[] | null | undefined, out: unknown[][]): void {
  if (!indices || indices.length < 3) return;
  for (let i = 1; i + 1 < indices.length; i++) out.push([indices[0], indices[i], indices[i + 1]]);
}

function parseJsonMesh(text: string): ParsedMesh {
  const data = JSON.parse(text) as Record<string, unknown>;
  const vertices = data.vertices ?? data.verts ?? data.points;
  const triangles = data.triangles ?? data.faces ?? data.tris;
  return assertMesh(vertices, triangles, "JSON mesh");
}

function parseObjIndex(token: string, vertexCount: number): number {
  const raw = token.split("/")[0];
  if (!raw) throw new Error(`Invalid OBJ face token "${token}"`);
  const index = Number.parseInt(raw, 10);
  if (!Number.isInteger(index) || index === 0) throw new Error(`Invalid OBJ vertex index "${token}"`);
  return index < 0 ? vertexCount + index : index - 1;
}

function parseObjMesh(text: string): ParsedMesh {
  const vertices: unknown[][] = [];
  const triangles: unknown[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v") {
      if (parts.length < 4) throw new Error(`OBJ vertex line needs 3 coordinates: "${line}"`);
      vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (parts[0] === "f") {
      const indices = parts.slice(1).map((part) => parseObjIndex(part, vertices.length));
      triangulate(indices, triangles);
    }
  }
  return assertMesh(vertices, triangles, "OBJ mesh");
}

function findPlyHeaderEnd(bytes: Uint8Array): number {
  const needle = new TextEncoder().encode("end_header");
  outer:
  for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    let k = i + needle.length;
    while (k < bytes.length && bytes[k] !== 10) k++;
    if (k >= bytes.length) throw new Error("PLY header is missing a trailing newline");
    return k + 1;
  }
  throw new Error("PLY header is missing end_header");
}

function parsePlyHeader(headerText: string): PlyHeader {
  const lines = headerText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "ply") throw new Error("Not a PLY file");
  const formatLine = lines.find((line) => line.startsWith("format "));
  if (!formatLine) throw new Error("PLY format line is missing");
  const format = formatLine.split(/\s+/)[1];
  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;
  for (const line of lines) {
    if (line.startsWith("comment ") || line === "ply" || line.startsWith("format ")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "element") {
      current = { name: parts[1], count: Number.parseInt(parts[2], 10), properties: [] };
      if (!Number.isInteger(current.count) || current.count < 0) throw new Error(`Invalid PLY element count: ${line}`);
      if (current.count > MAX_PLY_ELEMENTS) {
        throw new Error(`PLY element count exceeds limit (${current.count} > ${MAX_PLY_ELEMENTS})`);
      }
      elements.push(current);
    } else if (parts[0] === "property" && current) {
      if (parts[1] === "list") {
        current.properties.push({ kind: "list", countType: parts[2], itemType: parts[3], name: parts[4] });
      } else {
        current.properties.push({ kind: "scalar", type: parts[1], name: parts[2] });
      }
    }
  }
  return { format, elements };
}

function readBinaryScalar(view: DataView, state: { offset: number }, type: string, littleEndian: boolean): number {
  const offset = state.offset;
  const size = SCALAR_BYTES[type];
  if (!size) throw new Error(`Unsupported PLY scalar type: ${type}`);
  if (offset + size > view.byteLength) throw new Error("Unexpected end of PLY binary data");
  state.offset += size;
  switch (type) {
    case "char":
    case "int8":
      return view.getInt8(offset);
    case "uchar":
    case "uint8":
      return view.getUint8(offset);
    case "short":
    case "int16":
      return view.getInt16(offset, littleEndian);
    case "ushort":
    case "uint16":
      return view.getUint16(offset, littleEndian);
    case "int":
    case "int32":
      return view.getInt32(offset, littleEndian);
    case "uint":
    case "uint32":
      return view.getUint32(offset, littleEndian);
    case "float":
    case "float32":
      return view.getFloat32(offset, littleEndian);
    case "double":
    case "float64":
      return view.getFloat64(offset, littleEndian);
    default:
      throw new Error(`Unsupported PLY scalar type: ${type}`);
  }
}

function readAsciiScalar(tokens: string[], state: { index: number }, type: string): number {
  if (state.index >= tokens.length) throw new Error("Unexpected end of PLY ASCII data");
  const raw = tokens[state.index++];
  const value = type.includes("float") || type === "double" ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Invalid PLY scalar value: ${raw}`);
  return value;
}

function readAsciiList(tokens: string[], state: { index: number }, prop: PlyListProperty): number[] {
  const count = readAsciiScalar(tokens, state, prop.countType);
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(readAsciiScalar(tokens, state, prop.itemType));
  return values;
}

function readBinaryList(view: DataView, state: { offset: number }, prop: PlyListProperty, littleEndian: boolean): number[] {
  const count = readBinaryScalar(view, state, prop.countType, littleEndian);
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(readBinaryScalar(view, state, prop.itemType, littleEndian));
  return values;
}

function parsePlyAscii(bytes: Uint8Array, headerEnd: number, elements: PlyElement[]): ParsedMesh {
  const tokens = TEXT_DECODER.decode(bytes.slice(headerEnd)).split(/\s+/).filter(Boolean);
  const state = { index: 0 };
  const vertices: unknown[][] = [];
  const colors: unknown[][] = [];
  const triangles: unknown[][] = [];
  for (const element of elements) {
    for (let i = 0; i < element.count; i++) {
      const row = Object.create(null) as Record<string, unknown>;
      let faceIndices: unknown[] | null = null;
      let firstList: unknown[] | null = null;
      for (const prop of element.properties) {
        if (prop.kind === "list") {
          const value = readAsciiList(tokens, state, prop);
          row[prop.name] = value;
          if (!firstList) firstList = value;
          if (!faceIndices && /^(vertex_indices|vertex_index|vertices|verts)$/.test(prop.name)) faceIndices = value;
        } else {
          row[prop.name] = readAsciiScalar(tokens, state, prop.type);
        }
      }
      if (element.name === "vertex") {
        vertices.push([row.x, row.y, row.z]);
        const r = row.red ?? row.diffuse_red ?? row.r;
        const g = row.green ?? row.diffuse_green ?? row.g;
        const b = row.blue ?? row.diffuse_blue ?? row.b;
        if (r != null && g != null && b != null) colors.push([r, g, b]);
      }
      if (element.name === "face") triangulate(faceIndices ?? firstList, triangles);
    }
  }
  return assertMesh(vertices, triangles, "PLY mesh", colors.length === vertices.length ? colors : null);
}

function parsePlyBinary(buffer: ArrayBuffer, headerEnd: number, elements: PlyElement[], littleEndian: boolean): ParsedMesh {
  const view = new DataView(buffer);
  const state = { offset: headerEnd };
  const vertices: unknown[][] = [];
  const colors: unknown[][] = [];
  const triangles: unknown[][] = [];
  for (const element of elements) {
    for (let i = 0; i < element.count; i++) {
      const row = Object.create(null) as Record<string, unknown>;
      let faceIndices: unknown[] | null = null;
      let firstList: unknown[] | null = null;
      for (const prop of element.properties) {
        if (prop.kind === "list") {
          const value = readBinaryList(view, state, prop, littleEndian);
          row[prop.name] = value;
          if (!firstList) firstList = value;
          if (!faceIndices && /^(vertex_indices|vertex_index|vertices|verts)$/.test(prop.name)) faceIndices = value;
        } else {
          row[prop.name] = readBinaryScalar(view, state, prop.type, littleEndian);
        }
      }
      if (element.name === "vertex") {
        vertices.push([row.x, row.y, row.z]);
        const r = row.red ?? row.diffuse_red ?? row.r;
        const g = row.green ?? row.diffuse_green ?? row.g;
        const b = row.blue ?? row.diffuse_blue ?? row.b;
        if (r != null && g != null && b != null) colors.push([r, g, b]);
      }
      if (element.name === "face") triangulate(faceIndices ?? firstList, triangles);
    }
  }
  return assertMesh(vertices, triangles, "PLY mesh", colors.length === vertices.length ? colors : null);
}

function parsePlyMesh(buffer: ArrayBuffer): ParsedMesh {
  const bytes = new Uint8Array(buffer);
  const headerEnd = findPlyHeaderEnd(bytes);
  const headerText = TEXT_DECODER.decode(bytes.slice(0, headerEnd));
  const { format, elements } = parsePlyHeader(headerText);
  if (format === "ascii") return parsePlyAscii(bytes, headerEnd, elements);
  if (format === "binary_little_endian") return parsePlyBinary(buffer, headerEnd, elements, true);
  if (format === "binary_big_endian") return parsePlyBinary(buffer, headerEnd, elements, false);
  throw new Error(`Unsupported PLY format: ${format}`);
}

export async function parseMeshFile(file: File): Promise<ParsedMesh> {
  const name = (file?.name || "").toLowerCase();
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_MESH_BYTES) {
    throw new Error(`网格文件过大（${(buffer.byteLength / 1048576).toFixed(0)}MB），超过 ${MAX_MESH_BYTES / 1048576}MB 上限，请精简后再导入`);
  }
  if (name.endsWith(".obj")) return parseObjMesh(TEXT_DECODER.decode(buffer));
  if (name.endsWith(".ply")) return parsePlyMesh(buffer);
  if (name.endsWith(".json")) return parseJsonMesh(TEXT_DECODER.decode(buffer));
  throw new Error("Unsupported mesh file type. Please upload .json, .obj, or .ply.");
}

export const __meshIoForTests = {
  parseJsonMesh,
  parseObjMesh,
  parsePlyMesh,
};
