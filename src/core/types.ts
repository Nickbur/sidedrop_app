export type Direction = 'send' | 'recv';
export type ItemKind = 'file' | 'text';

export type TransferStatus =
    | 'queued'
    | 'active'
    | 'paused'
    | 'ready'
    | 'done'
    | 'completed'
    | 'failed'
    | 'canceled';

/** Metadata announced on the wire for one transferred item. */
export interface ItemMeta {
    i: number;
    id: string;
    name: string;
    size: number;
    mime: string;
    kind: ItemKind;
    relPath?: string;
}

/** A row as tracked in the UI (either direction). */
export interface TransferItem extends ItemMeta {
    dir: Direction;
    status: TransferStatus;
    transferred: number;
    speed: number;
    eta: number;
    error?: string;
    text?: string;
}

export type ConnectionStatus =
    | 'idle'
    | 'connecting'
    | 'waiting'
    | 'connected'
    | 'reconnecting'
    | 'closed'
    | 'error';

export interface IceServerConfig {
    urls: string | string[];
    username?: string;
    credential?: string;
}
