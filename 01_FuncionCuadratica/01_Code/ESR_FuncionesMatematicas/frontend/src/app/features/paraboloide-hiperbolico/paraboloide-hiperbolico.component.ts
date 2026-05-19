import { AfterViewInit, Component, ElementRef, inject, OnDestroy, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RuledCurveInput, SurfaceService } from '../../services/surface.service';
import { FormsModule } from '@angular/forms';

const CURVE_FORMAT_ERROR = 'Formato incorrecto. Escribe: x(t), y(t), z(t) separados por comas.';

@Component({
  standalone: true,
  selector: 'app-paraboloide-hiperbolico',
  templateUrl: './paraboloide-hiperbolico.html',
  styleUrl: './paraboloide-hiperbolico.scss',
  imports: [FormsModule],
})
export class ParaboloideHiperbolicoComponent implements AfterViewInit, OnDestroy {
  private readonly surfaceSize = 4;
  private readonly surfaceSegments = 80;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private surfaceMesh!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private curveALine?: THREE.Line;
  private curveBLine?: THREE.Line;
  private rulingLines?: THREE.LineSegments;
  private animationFrameId = 0;
  private resizeObserver?: ResizeObserver;
  private controls!: OrbitControls;

  private timer: any;

  private surfaceService = inject(SurfaceService);

  mode: 'function' | 'ruled' = 'function' as const;

  functionExpression = 'x^2 - y^2';
  surfaceError = '';

  curveAExpression = '-2, -2 + 4*t, 4 - (-2 + 4*t)^2';
  curveBExpression = '2, -2 + 4*t, 4 - (-2 + 4*t)^2';

  @ViewChild('canvasContainer', { static: true })
  canvasContainer!: ElementRef<HTMLDivElement>;

  ngAfterViewInit(): void {
    this.initScene();
    this.createSurface();
    this.observeResize();
    this.animate();
    this.createSurfaceFromMode();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();

    if (this.surfaceMesh) {
      this.surfaceMesh.geometry.dispose();
      this.surfaceMesh.material.dispose();
    }

    this.clearCurveLines();

    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  onParamsChange(): void {
    clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      this.createSurfaceFromMode();
    }, 250);
  }

  resetView(): void {
    this.camera.position.set(6, 5, 7);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private initScene(): void {
    const container = this.canvasContainer.nativeElement;

    // 1. ESCENA
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf2f4f7);
    this.scene.fog = new THREE.Fog(0x07111f, 12, 28);

    // 2. TAMAÑO REAL DEL CONTENEDOR
    const width = 900;
    const height = 500;

    // 3. CÁMARA
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);

    this.camera.position.set(6, 5, 7);
    this.camera.lookAt(0, 0, 0);

    // 4. RENDERER (CREAR PRIMERO)
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 🔥 IMPORTANTE: sincronizar tamaño aquí
    this.renderer.setSize(width, height, false);

    // 🔥 insertar canvas en el DOM
    container.appendChild(this.renderer.domElement);

    // 🔥 FORZAR CSS del canvas (evita desajustes)
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';

    // 5. LUCES
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.8);
    mainLight.position.set(6, 10, 8);
    this.scene.add(mainLight);

    const rimLight = new THREE.DirectionalLight(0x4f8cff, 0.8);
    rimLight.position.set(-6, 2, -4);
    this.scene.add(rimLight);

    // 6. HELPERS (opcional pero útil)
    const grid = new THREE.GridHelper(12, 24, 0x9fb3c8, 0xd6dee8);
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(3);
    this.scene.add(axes);
  }

  private createSurface(): void {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const indices: number[] = [];
    const segmentCount = this.surfaceSegments;
    const halfSize = this.surfaceSize / 2;

    for (let row = 0; row <= segmentCount; row++) {
      const v = row / segmentCount;
      const y = -halfSize + v * this.surfaceSize;

      for (let column = 0; column <= segmentCount; column++) {
        const u = column / segmentCount;
        const x = -halfSize + u * this.surfaceSize;
        const z = x * x - y * y;

        positions.push(x, y, z);
      }
    }

    for (let row = 0; row < segmentCount; row++) {
      for (let column = 0; column < segmentCount; column++) {
        const topLeft = row * (segmentCount + 1) + column;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + segmentCount + 1;
        const bottomRight = bottomLeft + 1;

        indices.push(topLeft, bottomLeft, topRight);
        indices.push(topRight, bottomLeft, bottomRight);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.center();

    const material = new THREE.MeshStandardMaterial({
      color: 0x4f8cff,
      metalness: 0.12,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });

    this.surfaceMesh = new THREE.Mesh(geometry, material);
    this.surfaceMesh.rotation.x = -0.18;
    this.surfaceMesh.rotation.z = 0.28;
    this.scene.add(this.surfaceMesh);

    console.log('ParaboloideHiperbolicoComponent: superficie z = x^2 - y^2 creada');
  }

  private observeResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.canvasContainer.nativeElement);
    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    const { width, height } = this.getContainerSize();

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private getContainerSize(): { width: number; height: number } {
    const element = this.canvasContainer.nativeElement;
    const width = element.clientWidth || window.innerWidth;
    const height = element.clientHeight || window.innerHeight;

    return { width, height };
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    this.controls?.update();

    this.renderer.render(this.scene, this.camera);
  };

  private createSurfaceFromMode(): void {
    // Limpiar superficie y curvas anteriores
    if (this.surfaceMesh) {
      this.scene.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      (this.surfaceMesh.material as THREE.Material).dispose();
    }

    this.clearCurveLines();
    this.surfaceError = '';

    if (this.mode === 'ruled') {
      const curveA = this.parseCurveExpression(this.curveAExpression);
      const curveB = this.parseCurveExpression(this.curveBExpression);

      if (!curveA || !curveB) {
        this.surfaceError = CURVE_FORMAT_ERROR;
        return;
      }
    }

    const request$ =
      this.mode === 'function'
        ? this.surfaceService.getSurfaceFromExpression(this.functionExpression)
        : this.surfaceService.getSurface('ruled', {
            a: 1, b: 1, c: 0, size: 4, segments: 60,
            curve_a: this.parseCurveExpression(this.curveAExpression)!,
            curve_b: this.parseCurveExpression(this.curveBExpression)!,
          });

    request$.subscribe({
      next: (data) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
        geometry.setIndex(data.indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
          color: 0x4f8cff,
          metalness: 0.1,
          roughness: 0.4,
          side: THREE.DoubleSide,
        });

        this.surfaceMesh = new THREE.Mesh(geometry, material);
        this.surfaceMesh.rotation.x = -0.2;
        this.surfaceMesh.rotation.z = 0.2;
        this.scene.add(this.surfaceMesh);

        // Dibujar curvas directrices y líneas de reglado en modo reglada
        if (this.mode === 'ruled' && data.curve_a_positions && data.curve_b_positions) {
          // Superficie semitransparente para que se vean las líneas de reglado
          material.transparent = true;
          material.opacity = 0.65;

          this.curveALine = this.buildCurveLine(data.curve_a_positions, 0xff4d4d);
          this.curveBLine = this.buildCurveLine(data.curve_b_positions, 0xffaa00);
          this.scene.add(this.curveALine);
          this.scene.add(this.curveBLine);

          // Líneas de reglado: conectan puntos homólogos de ambas curvas
          this.rulingLines = this.buildRulingLines(data.curve_a_positions, data.curve_b_positions, 4);
          this.scene.add(this.rulingLines);
        }
      },

      error: (err) => {
        this.surfaceError = err?.error?.detail ?? 'No se pudo generar la superficie con esa expresión.';
        console.error('Error cargando superficie desde backend:', err);
      },
    });
  }

  /**
   * Parsea "x(t), y(t), z(t)" → { x, y, z }.
   * Devuelve null si no hay exactamente 3 partes separadas por coma.
   */
  private parseCurveExpression(expr: string): RuledCurveInput | null {
    const parts = expr.split(',').map((s) => s.trim());
    if (parts.length !== 3 || parts.some((p) => p === '')) return null;
    return { x: parts[0], y: parts[1], z: parts[2] };
  }

  /** Construye una THREE.Line a partir de un array plano [x,y,z, x,y,z, ...]. */
  private buildCurveLine(positions: number[], color: number): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const line = new THREE.Line(geometry, material);
    line.rotation.x = -0.2;
    line.rotation.z = 0.2;
    return line;
  }

  /** Construye LineSegments conectando puntos homólogos de curvaA y curvaB. */
  private buildRulingLines(aPos: number[], bPos: number[], every = 4): THREE.LineSegments {
    const n = Math.floor(Math.min(aPos.length, bPos.length) / 3);
    const verts: number[] = [];
    for (let i = 0; i < n; i += every) {
      verts.push(aPos[i * 3], aPos[i * 3 + 1], aPos[i * 3 + 2]);
      verts.push(bPos[i * 3], bPos[i * 3 + 1], bPos[i * 3 + 2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.rotation.x = -0.2;
    lines.rotation.z = 0.2;
    return lines;
  }

  /** Elimina las líneas de las curvas directrices y de reglado de la escena. */
  private clearCurveLines(): void {
    for (const line of [this.curveALine, this.curveBLine]) {
      if (line) {
        this.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
    }
    this.curveALine = undefined;
    this.curveBLine = undefined;

    if (this.rulingLines) {
      this.scene.remove(this.rulingLines);
      this.rulingLines.geometry.dispose();
      (this.rulingLines.material as THREE.Material).dispose();
      this.rulingLines = undefined;
    }
  }
}
