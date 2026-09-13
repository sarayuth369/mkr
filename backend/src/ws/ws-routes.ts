import { ApiError } from '../errors';
import type { Env } from '../types';

const ROOM_ID = 'global';

/** Routes the client WebSocket upgrade to the single shared [MarketStreamRoom] instance. */
export async function handleMarketStream(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    throw new ApiError('INVALID_PARAMETER', 'This endpoint only accepts WebSocket upgrade requests.');
  }
  const id = env.MARKET_STREAM.idFromName(ROOM_ID);
  const room = env.MARKET_STREAM.get(id);
  return room.fetch(request);
}
