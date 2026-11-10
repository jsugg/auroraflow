// Minimal OTLP protobuf reader for resource attributes, kept dependency-free so parity tests do
// not lean on SDK internals. ExportTraceServiceRequest and ExportMetricsServiceRequest share the
// prefix this needs: field 1 = Resource{Spans|Metrics}, whose field 1 = Resource, whose repeated
// field 1 = KeyValue { key = 1; value = 2 (AnyValue) }.

const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;

const ANY_VALUE_FIELDS = {
  1: 'stringValue',
  2: 'boolValue',
  3: 'intValue',
  4: 'doubleValue',
  5: 'arrayValue',
  6: 'kvlistValue',
  7: 'bytesValue',
} as const;

interface ProtoField {
  readonly fieldNumber: number;
  readonly wireType: number;
  readonly bytes: Buffer;
  readonly varint: bigint;
}

function readVarint(
  buffer: Buffer,
  start: number,
): { readonly value: bigint; readonly next: number } {
  let value = 0n;
  let shift = 0n;
  for (let offset = start; offset < buffer.length; offset += 1) {
    const byte = buffer[offset] ?? 0;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, next: offset + 1 };
    }
    shift += 7n;
  }
  throw new Error('Truncated protobuf varint.');
}

function readFields(buffer: Buffer): readonly ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);
    offset = tag.next;
    if (wireType === WIRE_TYPE_VARINT) {
      const varint = readVarint(buffer, offset);
      fields.push({ fieldNumber, wireType, bytes: Buffer.alloc(0), varint: varint.value });
      offset = varint.next;
    } else if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const length = readVarint(buffer, offset);
      const end = length.next + Number(length.value);
      fields.push({ fieldNumber, wireType, bytes: buffer.subarray(length.next, end), varint: 0n });
      offset = end;
    } else if (wireType === WIRE_TYPE_FIXED64 || wireType === WIRE_TYPE_FIXED32) {
      const width = wireType === WIRE_TYPE_FIXED64 ? 8 : 4;
      fields.push({
        fieldNumber,
        wireType,
        bytes: buffer.subarray(offset, offset + width),
        varint: 0n,
      });
      offset += width;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}.`);
    }
  }
  return fields;
}

function subMessages(buffer: Buffer, fieldNumber: number): readonly Buffer[] {
  return readFields(buffer)
    .filter((field) => field.fieldNumber === fieldNumber)
    .map((field) => field.bytes);
}

// Non-string AnyValue kinds are rendered as `<kind>` so a type change is still visible in a diff.
function describeAnyValue(buffer: Buffer): string {
  const [field] = readFields(buffer);
  if (field === undefined) {
    return '<empty>';
  }
  if (field.fieldNumber === 1) {
    return field.bytes.toString('utf8');
  }
  const kind = ANY_VALUE_FIELDS[field.fieldNumber as keyof typeof ANY_VALUE_FIELDS] ?? 'unknown';
  return `<${kind}>`;
}

/** Decodes the resource attributes of every resource block in an OTLP trace or metric export. */
export function decodeOtlpResourceAttributes(
  payload: Buffer,
): readonly Readonly<Record<string, string>>[] {
  return subMessages(payload, 1).map((resourceBlock) => {
    const attributes: Record<string, string> = {};
    for (const resource of subMessages(resourceBlock, 1)) {
      for (const keyValue of subMessages(resource, 1)) {
        const fields = readFields(keyValue);
        const key = fields.find((field) => field.fieldNumber === 1)?.bytes.toString('utf8');
        const value = fields.find((field) => field.fieldNumber === 2)?.bytes;
        if (key !== undefined) {
          attributes[key] = value === undefined ? '<unset>' : describeAnyValue(value);
        }
      }
    }
    return attributes;
  });
}
