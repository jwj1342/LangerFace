const TEXT_DECODER = new TextDecoder("utf-8");

const SCALAR_BYTES = {
  char: 1, int8: 1,
  uchar: 1, uint8: 1,
  short: 2, int16: 2,
  ushort: 2, uint16: 2,
  int: 4, int32: 4,
  uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

function assertMesh(vertices, triangles, source, colors = null) {
  if (!Array.isArray(vertices) || !Array.isArray(triangles)) {
    throw new Error(`${source} must contain vertices and triangles`);
  }
  const cleanVertices = vertices.map((v, i) => {
    if (!Array.isArray(v) || v.length < 3) throw new Error(`Invalid vertex at index ${i}`);
    const p = [Number(v[0]), Number(v[1]), Number(v[2])];
    if (!p.every(Number.isFinite)) throw new Error(`Invalid vertex coordinates at index ${i}`);
    return p;
  });
  const cleanTriangles = triangles.map((t, i) => {
    if (!Array.isArray(t) || t.length < 3) throw new Error(`Invalid face at index ${i}`);
    const tri = [Number(t[0]), Number(t[1]), Number(t[2])].map((x) => Math.trunc(x));
    if (!tri.every((x) => Number.isInteger(x) && x >= 0 && x < cleanVertices.length)) {
      throw new Error(`Face ${i} references a vertex outside the mesh`);
    }
    return tri;
  });
  if (!cleanVertices.length || !cleanTriangles.length) {
    throw new Error(`${source} has ${cleanVertices.length} vertices and ${cleanTriangles.length} triangles`);
  }
  let cleanColors = null;
  if (Array.isArray(colors) && colors.length === cleanVertices.length) {
    cleanColors = colors.map((c, i) => {
      if (!Array.isArray(c) || c.length < 3) throw new Error(`Invalid vertex color at index ${i}`);
      const rgb = [Number(c[0]), Number(c[1]), Number(c[2])];
      if (!rgb.every(Number.isFinite)) throw new Error(`Invalid vertex color at index ${i}`);
      return rgb.map((x) => Math.max(0, Math.min(1, x > 1 ? x / 255 : x)));
    });
  }
  return { vertices: cleanVertices, triangles: cleanTriangles, colors: cleanColors };
}

function triangulate(indices, out) {
  if (!indices || indices.length < 3) return;
  for (let i = 1; i + 1 < indices.length; i++) out.push([indices[0], indices[i], indices[i + 1]]);
}

function parseJsonMesh(text) {
  const data = JSON.parse(text);
  const vertices = data.vertices ?? data.verts ?? data.points;
  const triangles = data.triangles ?? data.faces ?? data.tris;
  return assertMesh(vertices, triangles, "JSON mesh");
}

function parseObjIndex(token, vertexCount) {
  const raw = token.split("/")[0];
  if (!raw) throw new Error(`Invalid OBJ face token "${token}"`);
  const idx = Number.parseInt(raw, 10);
  if (!Number.isInteger(idx) || idx === 0) throw new Error(`Invalid OBJ vertex index "${token}"`);
  return idx < 0 ? vertexCount + idx : idx - 1;
}

function parseObjMesh(text) {
  const vertices = [];
  const triangles = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v") {
      vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (parts[0] === "f") {
      const indices = parts.slice(1).map((p) => parseObjIndex(p, vertices.length));
      triangulate(indices, triangles);
    }
  }
  return assertMesh(vertices, triangles, "OBJ mesh");
}

function findPlyHeaderEnd(bytes) {
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

function parsePlyHeader(headerText) {
  const lines = headerText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "ply") throw new Error("Not a PLY file");
  const formatLine = lines.find((line) => line.startsWith("format "));
  if (!formatLine) throw new Error("PLY format line is missing");
  const format = formatLine.split(/\s+/)[1];
  const elements = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("comment ") || line === "ply" || line.startsWith("format ")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "element") {
      current = { name: parts[1], count: Number.parseInt(parts[2], 10), properties: [] };
      if (!Number.isInteger(current.count) || current.count < 0) throw new Error(`Invalid PLY element count: ${line}`);
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

function readBinaryScalar(view, state, type, littleEndian) {
  const offset = state.offset;
  const size = SCALAR_BYTES[type];
  if (!size) throw new Error(`Unsupported PLY scalar type: ${type}`);
  if (offset + size > view.byteLength) throw new Error("Unexpected end of PLY binary data");
  state.offset += size;
  switch (type) {
    case "char": case "int8": return view.getInt8(offset);
    case "uchar": case "uint8": return view.getUint8(offset);
    case "short": case "int16": return view.getInt16(offset, littleEndian);
    case "ushort": case "uint16": return view.getUint16(offset, littleEndian);
    case "int": case "int32": return view.getInt32(offset, littleEndian);
    case "uint": case "uint32": return view.getUint32(offset, littleEndian);
    case "float": case "float32": return view.getFloat32(offset, littleEndian);
    case "double": case "float64": return view.getFloat64(offset, littleEndian);
    default: throw new Error(`Unsupported PLY scalar type: ${type}`);
  }
}

function readAsciiScalar(tokens, state, type) {
  if (state.index >= tokens.length) throw new Error("Unexpected end of PLY ASCII data");
  const raw = tokens[state.index++];
  const n = type.includes("float") || type === "double" ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid PLY scalar value: ${raw}`);
  return n;
}

function readAsciiList(tokens, state, prop) {
  const count = readAsciiScalar(tokens, state, prop.countType);
  const values = [];
  for (let i = 0; i < count; i++) values.push(readAsciiScalar(tokens, state, prop.itemType));
  return values;
}

function readBinaryList(view, state, prop, littleEndian) {
  const count = readBinaryScalar(view, state, prop.countType, littleEndian);
  const values = [];
  for (let i = 0; i < count; i++) values.push(readBinaryScalar(view, state, prop.itemType, littleEndian));
  return values;
}

function parsePlyAscii(bytes, headerEnd, elements) {
  const tokens = TEXT_DECODER.decode(bytes.slice(headerEnd)).split(/\s+/).filter(Boolean);
  const state = { index: 0 };
  const vertices = [];
  const colors = [];
  const triangles = [];
  for (const element of elements) {
    for (let i = 0; i < element.count; i++) {
      const row = {};
      let faceIndices = null;
      for (const prop of element.properties) {
        const value = prop.kind === "list" ? readAsciiList(tokens, state, prop) : readAsciiScalar(tokens, state, prop.type);
        row[prop.name] = value;
        if (prop.kind === "list" && !faceIndices && /^(vertex_indices|vertex_index|vertices|verts)$/.test(prop.name)) faceIndices = value;
      }
      if (element.name === "vertex") {
        vertices.push([row.x, row.y, row.z]);
        const r = row.red ?? row.diffuse_red ?? row.r;
        const g = row.green ?? row.diffuse_green ?? row.g;
        const b = row.blue ?? row.diffuse_blue ?? row.b;
        if (r != null && g != null && b != null) colors.push([r, g, b]);
      }
      if (element.name === "face") triangulate(faceIndices, triangles);
    }
  }
  return assertMesh(vertices, triangles, "PLY mesh", colors.length === vertices.length ? colors : null);
}

function parsePlyBinary(buffer, headerEnd, elements, littleEndian) {
  const view = new DataView(buffer);
  const state = { offset: headerEnd };
  const vertices = [];
  const colors = [];
  const triangles = [];
  for (const element of elements) {
    for (let i = 0; i < element.count; i++) {
      const row = {};
      let faceIndices = null;
      let firstList = null;
      for (const prop of element.properties) {
        const value = prop.kind === "list"
          ? readBinaryList(view, state, prop, littleEndian)
          : readBinaryScalar(view, state, prop.type, littleEndian);
        row[prop.name] = value;
        if (prop.kind === "list") {
          if (!firstList) firstList = value;
          if (!faceIndices && /^(vertex_indices|vertex_index|vertices|verts)$/.test(prop.name)) faceIndices = value;
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

function parsePlyMesh(buffer) {
  const bytes = new Uint8Array(buffer);
  const headerEnd = findPlyHeaderEnd(bytes);
  const headerText = TEXT_DECODER.decode(bytes.slice(0, headerEnd));
  const { format, elements } = parsePlyHeader(headerText);
  if (format === "ascii") return parsePlyAscii(bytes, headerEnd, elements);
  if (format === "binary_little_endian") return parsePlyBinary(buffer, headerEnd, elements, true);
  if (format === "binary_big_endian") return parsePlyBinary(buffer, headerEnd, elements, false);
  throw new Error(`Unsupported PLY format: ${format}`);
}

export async function parseMeshFile(file) {
  const name = (file?.name || "").toLowerCase();
  const buffer = await file.arrayBuffer();
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
