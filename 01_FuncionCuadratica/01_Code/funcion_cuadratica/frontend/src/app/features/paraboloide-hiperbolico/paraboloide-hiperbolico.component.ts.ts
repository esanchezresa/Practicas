import { AfterViewInit, Component, ElementRef, inject, OnDestroy, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SurfaceService } from '../../services/surface.service';

@Component({
  standalone: true,
  selector: 'app-paraboloide-hiperbolico',
  templateUrl: './paraboloide-hiperbolico.html',
  styleUrl: './paraboloide-hiperbolico.scss',
})
export class ParaboloideHiperbolicoComponent implements AfterViewInit, OnDestroy {
  private readonly surfaceSize = 4;
  private readonly surfaceSegments = 80;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private surfaceMesh!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private animationFrameId = 0;
  private resizeObserver?: ResizeObserver;
  private controls!: OrbitControls;

  private surfaceService = inject(SurfaceService);

  mode: 'function' | 'ruled' = 'function' as const;

  a = 1;
  b = 1;
  c = 0;

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

    if (this.renderer) {
      this.renderer.dispose();
    }
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
    // 🔴 1. Limpiar superficie anterior
    if (this.surfaceMesh) {
      this.scene.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      (this.surfaceMesh.material as THREE.Material).dispose();
    }

    // 🔵 2. Pedir geometría al backend
    this.surfaceService.getSurface(this.mode, this.a, this.b, this.c).subscribe({
      next: (data) => {
        // 🧠 3. Crear geometría Three.js desde backend
        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));

        geometry.setIndex(data.indices);

        geometry.computeVertexNormals();

        // 🎨 4. Material (solo visual)
        const material = new THREE.MeshStandardMaterial({
          color: 0x4f8cff,
          metalness: 0.1,
          roughness: 0.4,
          side: THREE.DoubleSide,
        });

        // 🧊 5. Crear mesh
        this.surfaceMesh = new THREE.Mesh(geometry, material);

        this.surfaceMesh.rotation.x = -0.2;
        this.surfaceMesh.rotation.z = 0.2;

        this.scene.add(this.surfaceMesh);
      },

      error: (err) => {
        console.error('Error cargando superficie desde backend:', err);
      },
    });
  }
}
