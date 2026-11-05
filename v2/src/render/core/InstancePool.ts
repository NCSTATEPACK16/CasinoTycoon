// Dense id ↔ instance-index map over a set of per-instance float channels.
// InstancedMesh draws instances [0, count), so the live set must stay packed:
// removing an instance swaps the last one into the hole and the moved id's
// index is rewritten. No WebGL here, so the bookkeeping is unit-testable; the
// GPU wrapper (PoolMesh) owns the InstancedMesh and uploads after edits.

export interface Channel {
  readonly itemSize: number;
  array: Float32Array;
}

export class InstancePool<Id = string> {
  /** ids[i] is the entity drawn by instance i, for i < count. */
  private ids: Id[] = [];
  private index = new Map<Id, number>();
  readonly channels: Channel[];
  capacity: number;
  /** Set when an edit reallocated the channel arrays; the owner must rebind them. */
  grown = false;
  /** Lowest index touched since the last clearDirty(), for partial uploads. */
  dirtyMin = Infinity;
  dirtyMax = -1;

  constructor(itemSizes: number[], capacity = 16) {
    this.capacity = Math.max(1, capacity);
    this.channels = itemSizes.map((itemSize) => ({
      itemSize,
      array: new Float32Array(itemSize * this.capacity),
    }));
  }

  get count(): number {
    return this.ids.length;
  }

  has(id: Id): boolean {
    return this.index.has(id);
  }

  indexOf(id: Id): number | undefined {
    return this.index.get(id);
  }

  idAt(i: number): Id | undefined {
    return i < this.ids.length ? this.ids[i] : undefined;
  }

  /** Append an instance and return its index. Re-adding a live id returns its index. */
  add(id: Id): number {
    const have = this.index.get(id);
    if (have !== undefined) return have;
    if (this.ids.length === this.capacity) this.grow(this.capacity * 2);
    const i = this.ids.length;
    this.ids.push(id);
    this.index.set(id, i);
    this.touch(i);
    return i;
  }

  /** Remove an instance. Returns the id that moved into its slot, if any. */
  remove(id: Id): Id | undefined {
    const i = this.index.get(id);
    if (i === undefined) return undefined;
    const last = this.ids.length - 1;
    this.index.delete(id);
    let moved: Id | undefined;
    if (i !== last) {
      moved = this.ids[last]!;
      this.ids[i] = moved;
      this.index.set(moved, i);
      for (const c of this.channels)
        c.array.copyWithin(i * c.itemSize, last * c.itemSize, (last + 1) * c.itemSize);
      this.touch(i);
    }
    this.ids.pop();
    return moved;
  }

  /** Write one instance's values into a channel. */
  set(channel: number, i: number, values: ArrayLike<number>, offset = 0): void {
    const c = this.channels[channel]!;
    const n = c.itemSize;
    for (let k = 0; k < n; k++) c.array[i * n + k] = values[offset + k]!;
    this.touch(i);
  }

  get(channel: number, i: number, out: number[] = []): number[] {
    const c = this.channels[channel]!;
    for (let k = 0; k < c.itemSize; k++) out[k] = c.array[i * c.itemSize + k]!;
    return out;
  }

  touch(i: number): void {
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  get dirty(): boolean {
    return this.dirtyMax >= this.dirtyMin;
  }

  clearDirty(): void {
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.grown = false;
  }

  private grow(capacity: number): void {
    for (const c of this.channels) {
      const next = new Float32Array(c.itemSize * capacity);
      next.set(c.array);
      c.array = next;
    }
    this.capacity = capacity;
    this.grown = true;
  }

  *entries(): IterableIterator<[Id, number]> {
    for (let i = 0; i < this.ids.length; i++) yield [this.ids[i]!, i];
  }
}
