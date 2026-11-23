import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RealtimeService } from './realtime.service';

/**
 * Single Socket.IO gateway. Authorization happens entirely here (server-side
 * room membership — see RealtimeService.resolveIdentity, unit-tested);
 * clients never pick their own rooms.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/socket.io',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly realtime: RealtimeService) {}

  afterInit(server: Server): void {
    this.realtime.attachServer(server);
  }

  async handleConnection(socket: Socket): Promise<void> {
    const identity = await this.realtime.resolveIdentity(
      socket.handshake.auth as Record<string, unknown> | undefined,
    );
    if (!identity) {
      // Reject rather than quietly leaving an unauthenticated socket open.
      this.logger.warn(`Rejected socket ${socket.id}: no valid credentials`);
      socket.emit('auth.rejected', { code: 'UNAUTHORIZED' });
      socket.disconnect(true);
      return;
    }
    socket.data.identity = identity;
    await this.realtime.joinAuthorizedRooms(socket, identity);
  }

  handleDisconnect(socket: Socket): void {
    void socket; // nothing to clean up — rooms are socket-scoped
  }
}
