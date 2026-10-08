import { handle } from '../../../lib/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function route(request: Request, context: Context): Promise<Response> {
  return handle(request, (await context.params).path);
}
export { route as GET, route as POST, route as PUT, route as DELETE };
