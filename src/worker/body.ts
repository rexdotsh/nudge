export async function readJson(request: Request, limit: number): Promise<{ body: unknown } | null> {
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) return null;
  let size = 0;
  const capped = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit) controller.error(new RangeError('request body too large'));
        else controller.enqueue(chunk);
      },
    }),
  );
  let text: string;
  try {
    text = capped ? await new Response(capped).text() : '';
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  try {
    return { body: text === '' ? null : JSON.parse(text) };
  } catch {
    return null;
  }
}
