import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, TimeoutError } from 'rxjs';
import { finalize, timeout } from 'rxjs/operators';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  CoastlineData,
  TerrainData,
  TerrainService,
} from '../../services/terrain.service';

@Component({
  selector: 'app-geo3d-viewer',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './geo3d-viewer.component.html',
  styleUrls: ['./geo3d-viewer.component.scss'],
})
export class Geo3dViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('container', { static: true })
  container!: ElementRef<HTMLDivElement>;

  distanceBetweenLighthouses = 1000;
  seaLevelMetres = 45;
  isLoading = true;
  loadError = '';

  private readonly terrainSvc = inject(TerrainService);
  private readonly cdr        = inject(ChangeDetectorRef);

  // ── Three.js objects ─────────────────────────────────────────────────────
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private animFrameId = 0;
  private resizeObserver?: ResizeObserver;
  private seaLevelRefreshTimer?: number;

  lighthouses: THREE.Mesh[] = [];
  private coastCurve?: THREE.CatmullRomCurve3;  // kept for compatibility
  private coastAllPts: THREE.Vector3[] = [];     // full ordered coast for lighthouse walk
  private terrainMesh?: THREE.Mesh;
  private coastLines: THREE.Line[] = [];
  private terrainData?: TerrainData;

  // ── Scale derived from terrain data ─────────────────────────────────────
  private cellScale   = 1;   // Three.js units per grid cell
  private elevScale   = 1;   // Three.js units per metre of elevation
  private cellSizeM   = 40;  // real-world metres per grid cell (step × 5)
  private centerX     = 0;
  private centerZ     = 0;

  // ════════════════════════════════════════════════════════════════════════
  ngAfterViewInit(): void {
    this.initScene();
    this.startAnimationLoop();

    forkJoin({
      terrain:   this.terrainSvc.getTerrain(8),
      coastline: this.terrainSvc.getCoastline(8),
    }).pipe(
      timeout(10_000),
      finalize(() => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: ({ terrain, coastline }) => {
        try {
          this.terrainData = terrain;
          this.computeScale(terrain);
          this.buildTerrainMesh(terrain);
          this.buildCoastline(terrain, coastline);
          this.createLighthouses(this.distanceBetweenLighthouses);
          this.fitCamera();
        } catch (buildErr) {
          this.loadError = (buildErr as Error)?.message ?? 'Error construyendo el terreno.';
          console.error('Terrain build error:', buildErr);
        }
      },
      error: (err) => {
        this.loadError = err instanceof TimeoutError
          ? 'No se pudo conectar con el servidor. Asegúrate de que el backend está en ejecución.'
          : (err?.message ?? 'Error cargando el terreno.');
        console.error('Terrain load error:', err);
      },
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animFrameId);
    if (this.seaLevelRefreshTimer) {
      window.clearTimeout(this.seaLevelRefreshTimer);
    }
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.terrainMesh?.geometry.dispose();
    (this.terrainMesh?.material as THREE.Material)?.dispose();
    this.coastLines.forEach(l => { l.geometry.dispose(); (l.material as THREE.Material).dispose(); });
    this.lighthouses.forEach(l => { l.geometry.dispose(); (l.material as THREE.Material).dispose(); });
    this.renderer?.dispose();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  UI handlers
  // ════════════════════════════════════════════════════════════════════════

  onDistanceChange(value: number): void {
    this.createLighthouses(value);
  }

  onSeaLevelChange(value: number): void {
    this.seaLevelMetres = value;
    this.scheduleSeaLevelRefresh();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Three.js init
  // ════════════════════════════════════════════════════════════════════════

  private initScene(): void {
    const el = this.container.nativeElement;
    const W = el.clientWidth  || 900;
    const H = el.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1628);
    this.scene.fog = new THREE.Fog(0x0a1628, 300, 800);

    this.camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 2000);
    this.camera.position.set(0, 80, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(W, H);
    el.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.07;
    this.controls.maxPolarAngle  = Math.PI / 2.05;
    this.controls.minDistance    = 5;
    this.controls.maxDistance    = 600;

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
    sun.position.set(80, 150, 60);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8ab4f8, 0.4);
    fill.position.set(-80, 40, -80);
    this.scene.add(fill);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
    this.resizeObserver.observe(el);
  }

  private startAnimationLoop(): void {
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Scale computation
  // ════════════════════════════════════════════════════════════════════════

  private computeScale(d: TerrainData): void {
    this.cellScale = 180 / Math.max(d.width, d.height);
    this.cellSizeM = d.cell_size_m;
    // Real-world scale: (cellScale / cellSizeM) maps metres → Three.js units.
    // Multiply by 4 for a moderate vertical exaggeration.
    this.elevScale = (this.cellScale / this.cellSizeM) * 4;
    this.centerX   = (d.width  / 2) * this.cellScale;
    this.centerZ   = (d.height / 2) * this.cellScale;
  }

  /** Converts a real-world distance in metres to Three.js units. */
  private mToUnits(metres: number): number {
    return metres * this.cellScale / this.cellSizeM;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Terrain mesh
  // ════════════════════════════════════════════════════════════════════════

  private buildTerrainMesh(d: TerrainData): void {
    const W = d.width, H = d.height;
    const CS = this.cellScale, ES = this.elevScale;
    const cx = this.centerX, cz = this.centerZ;

    const posArr   = new Float32Array(W * H * 3);
    const colorArr = new Float32Array(W * H * 3);
    const indices: number[] = [];

    // Fill vertices
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const i   = row * W + col;
        const elv = d.data[row][col];
        posArr[i*3]   = col * CS - cx;
        posArr[i*3+1] = elv * ES;
        posArr[i*3+2] = row * CS - cz;
        const {r,g,b} = this.elevationColor(elv, this.seaLevelMetres);
        colorArr[i*3]   = r;
        colorArr[i*3+1] = g;
        colorArr[i*3+2] = b;
      }
    }

    // Fill quad indices
    for (let row = 0; row < H-1; row++) {
      for (let col = 0; col < W-1; col++) {
        const tl = row * W + col;
        const tr = tl + 1;
        const bl = tl + W;
        const br = bl + 1;
        indices.push(tl, bl, tr,  tr, bl, br);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colorArr, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
      roughness: 0.85,
      metalness: 0.0,
    });

    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.terrainMesh);
  }

  /** Elevation → RGB colour (normalised 0–1 for Three.js vertex colours). */
  private elevationColor(elv: number, seaLevel: number): { r: number; g: number; b: number } {
    if (elv <= seaLevel) return { r: 0.08, g: 0.22, b: 0.42 };   // deep sea
    if (elv < seaLevel + 10) return { r: 0.74, g: 0.66, b: 0.45 };   // sand / beach
    if (elv < seaLevel + 80) return { r: 0.28, g: 0.54, b: 0.28 };   // lowland green
    if (elv < seaLevel + 300) return { r: 0.38, g: 0.48, b: 0.27 };   // mid-highland olive
    if (elv < seaLevel + 700) return { r: 0.50, g: 0.44, b: 0.36 };   // rocky brown
    return             { r: 0.85, g: 0.87, b: 0.90 };         // snow/peaks
  }

  private scheduleSeaLevelRefresh(): void {
    if (this.seaLevelRefreshTimer) {
      window.clearTimeout(this.seaLevelRefreshTimer);
    }

    this.seaLevelRefreshTimer = window.setTimeout(() => {
      this.seaLevelRefreshTimer = undefined;
      this.refreshSeaLevelView();
    }, 0);
  }

  private refreshSeaLevelView(): void {
    if (!this.terrainData || !this.terrainMesh) return;

    this.updateTerrainColors();
    this.buildDynamicCoastline(this.terrainData, this.seaLevelMetres);
    this.createLighthouses(this.distanceBetweenLighthouses);
  }

  private updateTerrainColors(): void {
    if (!this.terrainMesh || !this.terrainData) return;

    const colorAttr = this.terrainMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    let i = 0;
    for (let row = 0; row < this.terrainData.height; row++) {
      for (let col = 0; col < this.terrainData.width; col++) {
        const elevation = this.terrainData.data[row][col];
        const { r, g, b } = this.elevationColor(elevation, this.seaLevelMetres);
        colorAttr.setXYZ(i, r, g, b);
        i++;
      }
    }
    colorAttr.needsUpdate = true;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Coastline
  // ════════════════════════════════════════════════════════════════════════

  private buildCoastline(_terrain: TerrainData, coast: CoastlineData): void {
    for (const l of this.coastLines) {
      this.scene.remove(l);
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
    this.coastLines = [];

    if (coast.points.length < 2) return;

    const CS = this.cellScale;
    const cx = this.centerX, cz = this.centerZ;

    const pts = coast.points.map(
      ([col, row]) => new THREE.Vector3(col * CS - cx, 0.5, row * CS - cz)
    );

    // The boundary walk guarantees each step ≤ sqrt(2) cells.
    // A gap larger than 4 cells means a disconnected segment → draw separately.
    const maxGap  = CS * 4;
    const dists   = pts.slice(1).map((p, i) => p.distanceTo(pts[i]));
    const segments: THREE.Vector3[][] = [];
    let seg: THREE.Vector3[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (dists[i - 1] <= maxGap) {
        seg.push(pts[i]);
      } else {
        if (seg.length >= 2) segments.push(seg);
        seg = [pts[i]];
      }
    }
    if (seg.length >= 2) segments.push(seg);

    for (const s of segments) {
      const geo = new THREE.BufferGeometry().setFromPoints(s);
      const mat = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 2 });
      this.coastLines.push(new THREE.Line(geo, mat));
      this.scene.add(this.coastLines[this.coastLines.length - 1]);
    }

    // Store all ordered points (across all segments) for lighthouse placement
    this.coastAllPts = pts;
  }

  private buildDynamicCoastline(data: TerrainData, seaLevel: number): void {
    for (const line of this.coastLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.coastLines = [];

    const coastlinePoints = this.extractCoastlinePoints(data, seaLevel);
    if (coastlinePoints.length < 2) {
      this.coastAllPts = [];
      return;
    }

    const points = coastlinePoints.map(
      ([col, row]) => new THREE.Vector3(
        col * this.cellScale - this.centerX,
        seaLevel * this.elevScale + 0.5,
        row * this.cellScale - this.centerZ,
      ),
    );

    const maxGap = this.cellScale * 4;
    const distances = points.slice(1).map((point, i) => point.distanceTo(points[i]));
    const segments: THREE.Vector3[][] = [];
    let segment: THREE.Vector3[] = [points[0]];

    for (let i = 1; i < points.length; i++) {
      if (distances[i - 1] <= maxGap) {
        segment.push(points[i]);
      } else {
        if (segment.length >= 2) segments.push(segment);
        segment = [points[i]];
      }
    }
    if (segment.length >= 2) segments.push(segment);

    for (const seg of segments) {
      const geometry = new THREE.BufferGeometry().setFromPoints(seg);
      const material = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 2 });
      const line = new THREE.Line(geometry, material);
      this.coastLines.push(line);
      this.scene.add(line);
    }

    this.coastAllPts = points;
  }

  private extractCoastlinePoints(data: TerrainData, seaLevel: number): [number, number][] {
    const points: [number, number][] = [];
    const subsample = 3;
    const isLand = (row: number, col: number) => data.data[row][col] > seaLevel;

    for (let row = 1; row < data.height - 1; row++) {
      for (let col = 1; col < data.width - 1; col++) {
        if (!isLand(row, col)) continue;

        const touchesSea =
          !isLand(row - 1, col) ||
          !isLand(row + 1, col) ||
          !isLand(row, col - 1) ||
          !isLand(row, col + 1);

        if (touchesSea) {
          points.push([col, row]);
        }
      }
    }

    return points.filter((_, index) => index % subsample === 0);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Lighthouses
  // ════════════════════════════════════════════════════════════════════════

  createLighthouses(distanceMetres: number): void {
    this.lighthouses.forEach(l => {
      this.scene.remove(l);
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    });
    this.lighthouses = [];

    if (!this.coastAllPts.length) return;

    const faroH  = Math.max(this.mToUnits(30), 3.5);   // ~30m lighthouse
    const faroR  = Math.max(this.mToUnits(6),  0.9);
    const geo    = new THREE.CylinderGeometry(faroR * 0.4, faroR, faroH, 8);
    const mat    = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.6 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
    const lightGeo = new THREE.SphereGeometry(faroR * 0.6, 8, 8);

    const positions = this.getPointsByDistance(distanceMetres);
    for (const pos of positions) {
      const body = new THREE.Mesh(geo, mat);
      body.position.set(pos.x, pos.y + faroH / 2, pos.z);
      this.scene.add(body);
      this.lighthouses.push(body);

      const lamp = new THREE.Mesh(lightGeo, lightMat);
      lamp.position.set(pos.x, pos.y + faroH + faroR * 0.6, pos.z);
      this.scene.add(lamp);
      this.lighthouses.push(lamp);
    }
  }

  private getPointsByDistance(distanceMetres: number): THREE.Vector3[] {
    const pts = this.coastAllPts;
    if (!pts.length) return [];

    const scaledDist = this.mToUnits(distanceMetres);

    // ── PCA: find the dominant direction of the coastline ──────────────────
    // Projecting onto the primary axis and spacing lighthouses along it avoids
    // the "walk inflates bay perimeters" problem that accumulated path distance
    // causes (bays look short visually but are long in pixel-walk distance).
    const n = pts.length;
    let meanX = 0, meanZ = 0;
    for (const p of pts) { meanX += p.x; meanZ += p.z; }
    meanX /= n; meanZ /= n;

    let cxx = 0, czz = 0, cxz = 0;
    for (const p of pts) {
      const dx = p.x - meanX, dz = p.z - meanZ;
      cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
    }
    // Dominant eigenvector of 2×2 covariance matrix
    const tr  = cxx + czz;
    const det = cxx * czz - cxz * cxz;
    const lam = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const ax  = new THREE.Vector2(lam - czz, cxz).normalize();

    // Project each coast point onto the primary axis
    const proj = pts.map(p => (p.x - meanX) * ax.x + (p.z - meanZ) * ax.y);
    const pMin = Math.min(...proj);
    const pMax = Math.max(...proj);

    // Place lighthouse positions at equal intervals along the axis,
    // then snap each to the nearest actual coast point
    const result: THREE.Vector3[] = [];
    const used = new Set<number>();

    for (let t = pMin; t <= pMax; t += scaledDist) {
      let best = -1, bestDiff = Infinity;
      for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;
        const d = Math.abs(proj[i] - t);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      if (best >= 0) {
        used.add(best);
        result.push(pts[best].clone());
      }
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Camera fit
  // ════════════════════════════════════════════════════════════════════════

  private fitCamera(): void {
    const span = Math.max(this.centerX, this.centerZ) * 2; // terrain width in Three.js units
    const d = span * 0.9;
    this.camera.position.set(0, d * 0.5, d * 0.85);
    this.controls.target.set(0, 0, 0);
    this.controls.maxDistance = span * 3;
    this.controls.update();
  }
}
