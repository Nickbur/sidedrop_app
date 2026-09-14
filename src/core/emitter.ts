type Handler<T> = (payload: T) => void;

/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handlers = new Map<keyof Events, Set<Handler<any>>>();

    on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
        let set = this.handlers.get(event);
        if (!set) {
            set = new Set();
            this.handlers.set(event, set);
        }
        set.add(handler);
        return () => this.off(event, handler);
    }

    off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
        this.handlers.get(event)?.delete(handler);
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        const set = this.handlers.get(event);
        if (!set) return;
        for (const handler of [...set]) handler(payload);
    }

    clear(): void {
        this.handlers.clear();
    }
}
