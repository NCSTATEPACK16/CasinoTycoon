// Recast tile builder for the casino floor. One walkable quad per floored,
// unoccupied cell, carrying its zone as the Recast area; no obstacle geometry
// at all. Objects are simply cells with no floor quad, and a solid wall is a
// two-voxel gap cut into the quads either side of its edge. Recast's erosion
// pass then pulls the walkable surface back by the agent radius from every
// gap, which is exactly the "footprint inflated by 0.3 m" of SPEC §7 — and
// it costs nothing per object.
//
// The standard generator in @recast-navigation/generators cannot do this: it
// re-marks every triangle RC_WALKABLE_AREA, so zones would be lost. This is
// its pipeline with our own area marking.

import {
  allocCompactHeightfield,
  allocContourSet,
  allocHeightfield,
  allocPolyMesh,
  allocPolyMeshDetail,
  buildCompactHeightfield,
  buildContours,
  buildDistanceField,
  buildPolyMesh,
  buildPolyMeshDetail,
  buildRegions,
  cloneRcConfig,
  createHeightfield,
  createNavMeshData,
  createRcConfig,
  erodeWalkableArea,
  filterLedgeSpans,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  freeCompactHeightfield,
  freeContourSet,
  freeHeightfield,
  freePolyMesh,
  freePolyMeshDetail,
  NavMeshCreateParams,
  rasterizeTriangles,
  Recast,
  RecastBuildContext,
  TriangleAreasArray,
  TrianglesArray,
  VerticesArray,
  type RawModule,
  type UnsignedCharArray,
} from '@recast-navigation/core';

/** Metres. One voxel is 10 cm: fine enough that a 1 m doorway stays a clear
 *  40 cm corridor after erosion, coarse enough that a tile bakes in a few ms. */
export const NAV_CS = 0.1;
export const NAV_CH = 0.1;
export const AGENT_RADIUS = 0.3;
export const AGENT_HEIGHT = 1.75;
/** 8 m tiles, per SPEC §7. */
export const TILE_METRES = 8;
const TILE_VOXELS = Math.round(TILE_METRES / NAV_CS);
/** How far each side of a solid wall's edge the floor is cut back. Two full
 *  voxels must end up empty or the rasteriser (which counts any partial
 *  coverage) would close the gap. */
const WALL_HALF_GAP = 0.12;

/** What the baker needs to know about the lot, and nothing else. */
export interface NavSource {
  cols: number;
  rows: number;
  /** True for a cell agents may stand on: floored and not under an object. */
  walkable(col: number, row: number): boolean;
  /** Recast area id for the cell (1..63; 0 is reserved for "no floor"). */
  area(col: number, row: number): number;
  /** A solid (non-door) wall on the edge — same edge ownership as FloorPlan. */
  solidWall(col: number, row: number, edge: 'n' | 'w'): boolean;
}

export interface TileBake {
  data: UnsignedCharArray | null;
  polys: number;
}

export class NavBaker {
  readonly tilesX: number;
  readonly tilesZ: number;
  private readonly rc: RawModule.rcConfig;
  private readonly ctx = new RecastBuildContext(false);
  private readonly verts = new VerticesArray();
  private readonly tris = new TrianglesArray();
  private readonly areas = new TriangleAreasArray();

  constructor(cols: number, rows: number) {
    this.tilesX = Math.ceil(cols / TILE_METRES);
    this.tilesZ = Math.ceil(rows / TILE_METRES);
    const walkableRadius = Math.ceil(AGENT_RADIUS / NAV_CS);
    const rc = createRcConfig({
      cs: NAV_CS,
      ch: NAV_CH,
      tileSize: TILE_VOXELS,
      walkableSlopeAngle: 45,
      walkableHeight: Math.ceil(AGENT_HEIGHT / NAV_CH),
      walkableClimb: 2,
      walkableRadius,
      maxEdgeLen: 40,
      maxSimplificationError: 1.1,
      minRegionArea: 4,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      // Floors are flat, so the detail mesh adds nothing — but a sample distance
      // of 0 crashes this WASM build inside rcBuildPolyMeshDetail.
      detailSampleDist: 0.6,
      detailSampleMaxError: 1,
    });
    rc.minRegionArea = rc.minRegionArea * rc.minRegionArea;
    rc.mergeRegionArea = rc.mergeRegionArea * rc.mergeRegionArea;
    rc.borderSize = walkableRadius + 3;
    rc.width = TILE_VOXELS + rc.borderSize * 2;
    rc.height = TILE_VOXELS + rc.borderSize * 2;
    this.rc = rc;
  }

  /** Navmesh params for NavMesh.initTiled. */
  get tileCount(): number {
    return this.tilesX * this.tilesZ;
  }

  /** Floor quads, in world space, for every cell overlapping [x0,x1]×[z0,z1]. */
  private gather(src: NavSource, x0: number, z0: number, x1: number, z1: number): number {
    const v: number[] = [];
    const t: number[] = [];
    const a: number[] = [];
    const c0 = Math.max(0, Math.floor(x0));
    const c1 = Math.min(src.cols - 1, Math.ceil(x1) - 1);
    const r0 = Math.max(0, Math.floor(z0));
    const r1 = Math.min(src.rows - 1, Math.ceil(z1) - 1);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (!src.walkable(col, row)) continue;
        const qx0 = col + (src.solidWall(col, row, 'w') ? WALL_HALF_GAP : 0);
        const qx1 = col + 1 - (src.solidWall(col + 1, row, 'w') ? WALL_HALF_GAP : 0);
        const qz0 = row + (src.solidWall(col, row, 'n') ? WALL_HALF_GAP : 0);
        const qz1 = row + 1 - (src.solidWall(col, row + 1, 'n') ? WALL_HALF_GAP : 0);
        const base = v.length / 3;
        v.push(qx0, 0, qz0, qx1, 0, qz0, qx1, 0, qz1, qx0, 0, qz1);
        // Counter-clockwise seen from +y, which is what Recast treats as up-facing.
        t.push(base, base + 2, base + 1, base, base + 3, base + 2);
        const area = src.area(col, row);
        a.push(area, area);
      }
    }
    if (t.length === 0) return 0;
    this.verts.copy(v);
    this.tris.copy(t);
    this.areas.copy(a);
    return t.length / 3;
  }

  /** Build one tile's Detour data. `data` is null when the tile has no floor. */
  bakeTile(src: NavSource, tx: number, tz: number): TileBake {
    const rc = cloneRcConfig(this.rc);
    const border = rc.borderSize * rc.cs;
    const bmin: [number, number, number] = [
      tx * TILE_METRES - border,
      -0.5,
      tz * TILE_METRES - border,
    ];
    const bmax: [number, number, number] = [
      (tx + 1) * TILE_METRES + border,
      2.5,
      (tz + 1) * TILE_METRES + border,
    ];
    for (let i = 0; i < 3; i++) {
      rc.set_bmin(i, bmin[i]!);
      rc.set_bmax(i, bmax[i]!);
    }
    const ntris = this.gather(src, bmin[0], bmin[2], bmax[0], bmax[2]);
    if (ntris === 0) return { data: null, polys: 0 };

    const ctx = this.ctx;
    const hf = allocHeightfield();
    let chf: ReturnType<typeof allocCompactHeightfield> | null = null;
    let cset: ReturnType<typeof allocContourSet> | null = null;
    let pmesh: ReturnType<typeof allocPolyMesh> | null = null;
    let dmesh: ReturnType<typeof allocPolyMeshDetail> | null = null;
    try {
      if (!createHeightfield(ctx, hf, rc.width, rc.height, bmin, bmax, rc.cs, rc.ch)) {
        throw new Error('createHeightfield failed');
      }
      const nverts = this.verts.size / 3;
      if (
        !rasterizeTriangles(
          ctx,
          this.verts,
          nverts,
          this.tris,
          this.areas,
          ntris,
          hf,
          rc.walkableClimb,
        )
      ) {
        throw new Error('rasterizeTriangles failed');
      }
      filterLowHangingWalkableObstacles(ctx, rc.walkableClimb, hf);
      filterLedgeSpans(ctx, rc.walkableHeight, rc.walkableClimb, hf);
      filterWalkableLowHeightSpans(ctx, rc.walkableHeight, hf);
      chf = allocCompactHeightfield();
      if (!buildCompactHeightfield(ctx, rc.walkableHeight, rc.walkableClimb, hf, chf)) {
        throw new Error('buildCompactHeightfield failed');
      }
      if (!erodeWalkableArea(ctx, rc.walkableRadius, chf)) throw new Error('erode failed');
      if (!buildDistanceField(ctx, chf)) throw new Error('buildDistanceField failed');
      if (!buildRegions(ctx, chf, rc.borderSize, rc.minRegionArea, rc.mergeRegionArea)) {
        throw new Error('buildRegions failed');
      }
      cset = allocContourSet();
      if (
        !buildContours(
          ctx,
          chf,
          rc.maxSimplificationError,
          rc.maxEdgeLen,
          cset,
          Recast.RC_CONTOUR_TESS_WALL_EDGES,
        )
      ) {
        throw new Error('buildContours failed');
      }
      pmesh = allocPolyMesh();
      if (!buildPolyMesh(ctx, cset, rc.maxVertsPerPoly, pmesh))
        throw new Error('buildPolyMesh failed');
      dmesh = allocPolyMeshDetail();
      if (
        !buildPolyMeshDetail(ctx, pmesh, chf, rc.detailSampleDist, rc.detailSampleMaxError, dmesh)
      ) {
        throw new Error('buildPolyMeshDetail failed');
      }
      const npolys = pmesh.npolys();
      if (npolys === 0) return { data: null, polys: 0 };
      // Areas are zone index + 1; flags carry one bit per zone so a query
      // filter can exclude whole zones (High-Limit, Back-of-House) cheaply.
      for (let i = 0; i < npolys; i++) pmesh.setFlags(i, 1 << (pmesh.areas(i) - 1));
      const params = new NavMeshCreateParams();
      params.setPolyMeshCreateParams(pmesh);
      params.setPolyMeshDetailCreateParams(dmesh);
      params.setWalkableHeight(rc.walkableHeight * rc.ch);
      params.setWalkableRadius(rc.walkableRadius * rc.cs);
      params.setWalkableClimb(rc.walkableClimb * rc.ch);
      params.setCellSize(rc.cs);
      params.setCellHeight(rc.ch);
      params.setBuildBvTree(true);
      params.setTileX(tx);
      params.setTileY(tz);
      const created = createNavMeshData(params);
      if (!created.success) throw new Error('createNavMeshData failed');
      return { data: created.navMeshData, polys: npolys };
    } finally {
      freeHeightfield(hf);
      if (chf) freeCompactHeightfield(chf);
      if (cset) freeContourSet(cset);
      if (pmesh) freePolyMesh(pmesh);
      if (dmesh) freePolyMeshDetail(dmesh);
    }
  }
}
