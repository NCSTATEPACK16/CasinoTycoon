import { describe, expect, it } from 'vitest';
import { IsoGrid } from './IsoGrid';
import { findPath } from './astar';

describe('A* pathfinding', () => {
  it('finds a straight path including both endpoints', () => {
    const grid = new IsoGrid(10, 10);
    const path = findPath(grid, { col: 0, row: 0 }, { col: 3, row: 0 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ col: 0, row: 0 });
    expect(path![path!.length - 1]).toEqual({ col: 3, row: 0 });
    expect(path!.length).toBe(4);
  });

  it('routes around occupied cells', () => {
    const grid = new IsoGrid(5, 5);
    // Wall of occupied cells across col 2 except row 4.
    grid.occupy('wall', 2, 0, 1, 4);
    const path = findPath(grid, { col: 0, row: 0 }, { col: 4, row: 0 });
    expect(path).not.toBeNull();
    for (const cell of path!) {
      expect(grid.isWalkable(cell.col, cell.row), `${cell.col},${cell.row}`).toBe(true);
    }
    // Must detour through row 4.
    expect(path!.some((c) => c.row === 4)).toBe(true);
  });

  it('returns null when the goal is unreachable', () => {
    const grid = new IsoGrid(5, 5);
    grid.occupy('wall', 2, 0, 1, 5); // full column wall
    expect(findPath(grid, { col: 0, row: 0 }, { col: 4, row: 0 })).toBeNull();
  });

  it('returns null when the goal cell itself is occupied', () => {
    const grid = new IsoGrid(5, 5);
    grid.occupy('x', 3, 3);
    expect(findPath(grid, { col: 0, row: 0 }, { col: 3, row: 3 })).toBeNull();
  });

  it('handles start === goal', () => {
    const grid = new IsoGrid(5, 5);
    expect(findPath(grid, { col: 2, row: 2 }, { col: 2, row: 2 })).toEqual([{ col: 2, row: 2 }]);
  });
});
