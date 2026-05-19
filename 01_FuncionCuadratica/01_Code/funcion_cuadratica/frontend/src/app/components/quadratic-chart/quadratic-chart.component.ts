import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import {
  AmbientLight,
  AxesHelper,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  GridHelper,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { QuadraticApiService } from '../../services/quadratic-api.service';

@Component({
  selector: 'app-quadratic-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './quadratic-chart.component.html',
  styleUrl: './quadratic-chart.component.scss'
})
export class QuadraticChartComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('canvasHost', { static: true }) private canvasHost?: ElementRef<HTMLDivElement>;

  @Input({ required: true }) points: Array<{ x: number; y: number }> = [];
  @Input() roots: number[] = [];
  @Input() vertexX: number | null = null;
  @Input() vertexY: number | null = null;
  @Input() isLoading = false;
  @Input() xMin = -5;
  @Input() xMax = 5;
  @Output() coefficientsChange = new EventEmitter<{ a: number; b: number; c: number; xMin: number; xMax: number }>();

  private readonly api = inject(QuadraticApiService);

  private scene?: Scene;
  private camera?: PerspectiveCamera;
  private renderer?: WebGLRenderer;
  private controls?: OrbitControls;

  private readonly curveGeometry = new BufferGeometry();
  private readonly curveMaterial = new LineBasicMaterial({ color: '#0d9488' });
  private curveLine?: Line<BufferGeometry, LineBasicMaterial>;

  private readonly markerGeometry = new SphereGeometry(0.18, 16, 16);
  private readonly vertexMarkerMaterial = new MeshBasicMaterial({ color: '#d9480f' });
  private readonly rootMarkerMaterial = new MeshBasicMaterial({ color: '#b45309' });
  private markersGroup?: Group;

  private readonly handleGeometry = new SphereGeometry(0.3, 16, 16);
  private readonly handleMaterial = new MeshBasicMaterial({ color: '#1e40af' });
  private handlesGroup?: Group;
  private handleMeshes: Mesh[] = [];

  private raycaster?: Raycaster;
  private plane?: Plane;
  private draggingHandle: Mesh | null = null;
  private isDragging = false;

  private needsRender = true;
  private renderFrameId: number | null = null;
  private resizeObserver?: ResizeObserver;
  private lastViewCenter = new Vector3(0, 0, 0);
  private lastViewSize = 10;
  private didAutofit = false;

  private readonly onControlsChange = (): void => {
    this.requestRender();
  };

  private readonly onPointerDownListener = (ev: PointerEvent): void => {
    this.onPointerDown(ev);
  };

  private readonly onPointerMoveListener = (ev: PointerEvent): void => {
    this.onPointerMove(ev);
  };

  private readonly onPointerUpListener = (ev: PointerEvent): void => {
    this.onPointerUp();
  };

  ngAfterViewInit(): void {
    this.initializeScene();
    this.refreshSceneFromInputs(true);
    this.requestRender();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      this.scene &&
      (changes['points'] || changes['roots'] || changes['vertexX'] || changes['vertexY'] || changes['xMin'] || changes['xMax'])
    ) {
      this.refreshSceneFromInputs(false);
    }
  }

  ngOnDestroy(): void {
    this.teardownScene();
  }

  resetZoom(): void {
    if (!this.camera || !this.controls) {
      return;
    }

    const cameraDistance = Math.max(this.lastViewSize * 1.08, 4.5);
    this.camera.position.set(
      this.lastViewCenter.x + (cameraDistance * 0.74),
      cameraDistance * 0.64,
      this.lastViewCenter.z + (cameraDistance * 0.76)
    );
    this.controls.target.copy(this.lastViewCenter);
    this.controls.update();
    this.requestRender();
  }

  private initializeScene(): void {
    const host = this.canvasHost?.nativeElement;
    if (!host) {
      return;
    }

    this.scene = new Scene();
    this.scene.background = new Color('#f8fcfc');
    this.scene.add(new AmbientLight(0xffffff, 1.6));

    const directionalLight = new DirectionalLight(0xffffff, 2.2);
    directionalLight.position.set(8, 12, 10);
    this.scene.add(directionalLight);

    this.camera = new PerspectiveCamera(45, 1, 0.1, 3000);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
    host.innerHTML = '';
    host.appendChild(this.renderer.domElement);

    const grid = new GridHelper(40, 20, 0x89a9ad, 0xd8e5e8);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);
    this.scene.add(new AxesHelper(12));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.maxDistance = 300;
    this.controls.minDistance = 0.45;
    this.controls.addEventListener('change', this.onControlsChange);

    this.curveLine = new Line(this.curveGeometry, this.curveMaterial);
    this.scene.add(this.curveLine);

    this.raycaster = new Raycaster();
    this.plane = new Plane(new Vector3(0, 0, 1), 0);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDownListener);
    window.addEventListener('pointermove', this.onPointerMoveListener);
    window.addEventListener('pointerup', this.onPointerUpListener);

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeRenderer();
    });
    this.resizeObserver.observe(host);

    this.resetZoom();
  }

  private refreshSceneFromInputs(rebuildHandles: boolean): void {
    if (!this.scene) {
      return;
    }

    const filteredPoints = this.points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));

    if (filteredPoints.length < 2) {
      this.curveGeometry.setFromPoints([]);
      this.clearMarkers();
      this.clearHandles();
      this.requestRender();
      return;
    }

    const curvePoints = filteredPoints.map((point) => new Vector3(point.x, point.y, 0));
    this.curveGeometry.setFromPoints(curvePoints);
    this.curveGeometry.computeBoundingSphere();
    this.curveGeometry.computeBoundingBox();

    this.renderMarkers();
    if (rebuildHandles || !this.isDragging) {
      this.updateHandles(filteredPoints);
    }

    const xValues = filteredPoints.map((point) => point.x);
    const yValues = filteredPoints.map((point) => point.y);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);

    this.lastViewCenter = new Vector3((xMin + xMax) / 2, (yMin + yMax) / 2, 0);
    this.lastViewSize = Math.max(xMax - xMin, yMax - yMin, 8);

    if (!this.didAutofit) {
      this.resetZoom();
      this.didAutofit = true;
    }

    this.requestRender();
  }

  private updateHandles(points: Array<{ x: number; y: number }>): void {
    this.clearHandles();

    if (!this.scene || points.length < 2) {
      return;
    }

    const left = points[0];
    const right = points[points.length - 1];
    const center = this.getCentralPoint(points);

    const group = new Group();
    const createHandle = (point: { x: number; y: number }): Mesh => {
      const mesh = new Mesh(this.handleGeometry, this.handleMaterial);
      mesh.position.set(point.x, point.y, 0);
      group.add(mesh);
      return mesh;
    };

    this.handleMeshes = [createHandle(left), createHandle(center), createHandle(right)];
    this.handlesGroup = group;
    this.scene.add(group);
  }

  private getCentralPoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
    if (Number.isFinite(this.vertexX)) {
      let closest = points[0];
      let closestDistance = Math.abs(points[0].x - (this.vertexX as number));

      for (const point of points) {
        const distance = Math.abs(point.x - (this.vertexX as number));
        if (distance < closestDistance) {
          closest = point;
          closestDistance = distance;
        }
      }

      return closest;
    }

    return points[Math.floor(points.length / 2)];
  }

  private renderMarkers(): void {
    this.clearMarkers();

    const group = new Group();
    const addMarker = (x: number, y: number, material: MeshBasicMaterial): void => {
      const marker = new Mesh(this.markerGeometry, material);
      marker.position.set(x, y, 0);
      group.add(marker);
    };

    if (Number.isFinite(this.vertexX) && Number.isFinite(this.vertexY)) {
      addMarker(this.vertexX as number, this.vertexY as number, this.vertexMarkerMaterial);
    }

    for (const root of this.roots) {
      if (Number.isFinite(root)) {
        addMarker(root, 0, this.rootMarkerMaterial);
      }
    }

    this.markersGroup = group;
    this.scene?.add(group);
  }

  private onPointerDown(ev: PointerEvent): void {
    if (!this.renderer || !this.camera || !this.raycaster) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new Vector2(x, y), this.camera);
    const intersects = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (intersects.length === 0) {
      return;
    }

    this.draggingHandle = intersects[0].object as Mesh;
    this.isDragging = true;
    this.controls?.enabled && (this.controls.enabled = false);
    (ev.target as Element).setPointerCapture?.(ev.pointerId);

    this.refreshSceneFromInputs(false);
    this.requestRender();
  }

  private onPointerMove(ev: PointerEvent): void {
    if (!this.draggingHandle || !this.renderer || !this.camera || !this.raycaster || !this.plane) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new Vector2(x, y), this.camera);
    const tmp = new Vector3();
    const intersection = this.raycaster.ray.intersectPlane(this.plane, tmp);

    if (!intersection) {
      return;
    }

    this.draggingHandle.position.x = intersection.x;
    this.draggingHandle.position.y = intersection.y;
    this.requestRender();
  }

  private onPointerUp(): void {
    if (!this.draggingHandle || this.handleMeshes.length < 3) {
      this.draggingHandle = null;
      this.controls && (this.controls.enabled = true);
      this.requestRender();
      return;
    }

    const p1 = this.handleMeshes[0].position;
    const p2 = this.handleMeshes[1].position;
    const p3 = this.handleMeshes[2].position;
    const xMin = Math.min(p1.x, p3.x);
    const xMax = Math.max(p1.x, p3.x);

    this.api
      .fitCoefficientsFromPoints({
        p1: { x: p1.x, y: p1.y },
        p2: { x: p2.x, y: p2.y },
        p3: { x: p3.x, y: p3.y },
        x_min: xMin,
        x_max: xMax
      })
      .subscribe({
        next: (coeffs) => {
          this.isDragging = false;
          this.coefficientsChange.emit({
            a: coeffs.a,
            b: coeffs.b,
            c: coeffs.c,
            xMin,
            xMax
          });
          this.requestRender();
        },
        error: () => {
          this.isDragging = false;
          this.requestRender();
          console.error('Failed to fit coefficients from points');
        }
      });

    this.draggingHandle = null;
    this.controls && (this.controls.enabled = true);
    this.requestRender();
  }

  private clearMarkers(): void {
    if (!this.markersGroup) {
      return;
    }

    this.scene?.remove(this.markersGroup);
    this.markersGroup = undefined;
  }

  private clearHandles(): void {
    if (!this.handlesGroup) {
      this.handleMeshes = [];
      this.draggingHandle = null;
      return;
    }

    this.scene?.remove(this.handlesGroup);
    this.handlesGroup = undefined;
    this.handleMeshes = [];
    this.draggingHandle = null;
  }

  private resizeRenderer(): void {
    if (!this.renderer || !this.camera || !this.canvasHost?.nativeElement) {
      return;
    }

    const host = this.canvasHost.nativeElement;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  private requestRender(): void {
    this.needsRender = true;

    if (this.renderFrameId !== null) {
      return;
    }

    this.renderFrameId = requestAnimationFrame(() => this.renderFrame());
  }

  private renderFrame(): void {
    this.renderFrameId = null;

    if (!this.renderer || !this.scene || !this.camera || !this.controls || !this.needsRender) {
      return;
    }

    this.needsRender = false;
    const needsAnotherFrame = this.controls.update();
    this.renderer.render(this.scene, this.camera);

    if (needsAnotherFrame || this.needsRender) {
      this.requestRender();
    }
  }

  private teardownScene(): void {
    if (this.renderFrameId !== null) {
      cancelAnimationFrame(this.renderFrameId);
      this.renderFrameId = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;

    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDownListener);
    }
    window.removeEventListener('pointermove', this.onPointerMoveListener);
    window.removeEventListener('pointerup', this.onPointerUpListener);

    this.controls?.removeEventListener('change', this.onControlsChange);
    this.controls?.dispose();
    this.controls = undefined;

    this.clearMarkers();
    this.clearHandles();

    if (this.curveLine) {
      this.scene?.remove(this.curveLine);
      this.curveLine = undefined;
    }

    this.curveGeometry.dispose();
    this.curveMaterial.dispose();
    this.markerGeometry.dispose();
    this.vertexMarkerMaterial.dispose();
    this.rootMarkerMaterial.dispose();
    this.handleGeometry.dispose();
    this.handleMaterial.dispose();

    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = undefined;

    this.scene = undefined;
    this.camera = undefined;
    this.raycaster = undefined;
    this.plane = undefined;
  }
}
