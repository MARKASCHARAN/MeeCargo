import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';

export interface PoolLiveEvent {
  poolId: string;
  poolCode: string;
  corridorId: string;
  slotId: string;
  status: string;
  weightUtilizationPct: number;
  volumeUtilizationPct: number;
  reservedWeightKg: number;
  capacityWeightKg: number;
  reservedVolumeCbm: number;
  capacityVolumeCbm: number;
  shipmentCount: number;
  projectedRatePaisePerKg: number;
  appliedTierLabel: string;
  isEstimateFinal: boolean;
  viabilityStatus: string;
  updatedAt: string;
}

let ioInstance: Server | null = null;

export function attachSocketGateway(server: HttpServer): Server {
  ioInstance = new Server(server, {
    cors: {
      origin: env.ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  ioInstance.on('connection', (socket) => {
    socket.on('join:pool', (poolId: string) => {
      if (typeof poolId === 'string' && poolId.length > 0) {
        void socket.join(`pool:${poolId}`);
      }
    });

    socket.on('leave:pool', (poolId: string) => {
      if (typeof poolId === 'string' && poolId.length > 0) {
        void socket.leave(`pool:${poolId}`);
      }
    });

    socket.on('join:corridor', (corridorId: string) => {
      if (typeof corridorId === 'string' && corridorId.length > 0) {
        void socket.join(`corridor:${corridorId}`);
      }
    });

    socket.on('join:driver', (driverId: string) => {
      if (typeof driverId === 'string' && driverId.length > 0) {
        void socket.join(`driver:${driverId}`);
      }
    });

    socket.on('join:shipment', (shipmentId: string) => {
      if (typeof shipmentId === 'string' && shipmentId.length > 0) {
        void socket.join(`shipment:${shipmentId}`);
      }
    });
  });

  return ioInstance;
}

export function emitPoolUpdated(payload: PoolLiveEvent): void {
  if (!ioInstance) return;
  ioInstance.to(`pool:${payload.poolId}`).emit('pool:updated', payload);
  ioInstance.to(`corridor:${payload.corridorId}`).emit('pool:updated', payload);
  ioInstance.emit('pools:changed', payload);
}

export function emitDriverAssignment(
  driverId: string,
  payload: {
    tripId: string;
    tripCode: string;
    status: string;
    eventType: string;
    message: string;
    plannedDepartureAt: string;
  }
): void {
  if (!ioInstance) return;
  ioInstance.to(`driver:${driverId}`).emit('driver:assignment', payload);
}

export function emitShipmentProgress(
  shipmentId: string,
  payload: {
    shipmentId: string;
    reference: string;
    status: string;
    tripId?: string;
    occurredAt: string;
    note?: string;
  }
): void {
  if (!ioInstance) return;
  ioInstance.to(`shipment:${shipmentId}`).emit('shipment:updated', payload);
  ioInstance.emit('shipments:changed', payload);
}
