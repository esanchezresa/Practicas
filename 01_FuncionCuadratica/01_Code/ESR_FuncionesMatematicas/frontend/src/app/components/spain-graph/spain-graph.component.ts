import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  HostListener,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ArcGisMapServerImageryProvider,
  Cartesian2,
  Cartesian3,
  Color,
  HeightReference,
  LabelStyle,
  Math as CesiumMath,
  Rectangle,
  VerticalOrigin,
  Viewer,
  NearFarScalar,
  PolylineGlowMaterialProperty,
  PolylineOutlineMaterialProperty,
  createWorldTerrainAsync,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
} from 'cesium';
import {
  Capital,
  GraphData,
  GraphEdge,
  GraphService,
  RouteResult,
} from '../../services/graph.service';

type BasemapStyle = 'satellite' | 'road' | 'topo';

const GEO = {
  latMin: 27.0,
  latMax: 44.2,
  lngMin: -18.5,
  lngMax: 5.0,
};

const SPAIN_RECTANGLE = Rectangle.fromDegrees(GEO.lngMin, GEO.latMin, GEO.lngMax, GEO.latMax);

const BASEMAPS: Record<BasemapStyle, { label: string; url: string }> = {
  satellite: {
    label: 'Satelite',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
  },
  road: {
    label: 'Carreteras',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer',
  },
  topo: {
    label: 'Topografico',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer',
  },
};

@Component({
  selector: 'app-spain-graph',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './spain-graph.component.html',
  styleUrl: './spain-graph.component.scss',
})
export class SpainGraphComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapHost', { static: true }) mapHostRef!: ElementRef<HTMLDivElement>;
  @ViewChild('cesiumCredits', { static: true }) cesiumCreditsRef!: ElementRef<HTMLDivElement>;
  @ViewChild('mainAppContainer') mainAppContainer!: ElementRef;

  private readonly gs = inject(GraphService);
  private readonly cdr = inject(ChangeDetectorRef);
  private ngZone: NgZone = inject(NgZone);

  readonly basemapOptions: { value: BasemapStyle; label: string }[] = [
    { value: 'satellite', label: BASEMAPS.satellite.label },
    { value: 'road', label: BASEMAPS.road.label },
    { value: 'topo', label: BASEMAPS.topo.label },
  ];

  basemapStyle: BasemapStyle = 'topo';

  capitals: Capital[] = [];
  graph: GraphData | null = null;
  route: RouteResult | null = null;

  selectedOrigin = '';
  selectedDestination = '';

  isLoading = true;
  isRouting = false;
  errorMsg = '';

  isFullscreen = false;

  private viewer?: Viewer;
  private resizeObs?: ResizeObserver;
  private basemapLoadToken = 0;

  ngAfterViewInit(): void {
    this.loadGraph();
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.viewer?.destroy();
    this.viewer = undefined;
  }

  async onBasemapChange(style: BasemapStyle): Promise<void> {
    this.basemapStyle = style;
    await this.applyBasemap();
  }

  resetCamera(): void {
    if (!this.viewer) return;

    this.viewer.camera.flyTo({
      destination: SPAIN_RECTANGLE,
      duration: 1, // Animación fluida de 1.5 segundos
      orientation: {
        heading: 0,
        pitch: CesiumMath.toRadians(-90), // La misma inclinación inicial
        roll: 0,
      },
    });
  }

  onSelectionChange(): void {
    this.rebuildMap();
  }

  calculateRoute(): void {
    if (!this.selectedOrigin || !this.selectedDestination) return;

    this.isRouting = true;
    this.errorMsg = '';
    this.route = null;

    this.gs.calculateRoute(this.selectedOrigin, this.selectedDestination).subscribe({
      next: (route) => {
        this.route = route;
        this.isRouting = false;
        this.rebuildMap(); // Esto borra todo y redibuja la red + la ruta nueva
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isRouting = false;
        this.errorMsg = err?.error?.detail ?? 'Error al calcular la ruta.';
        this.cdr.markForCheck();
      },
    });
  }
  toggleFullscreen(): void {
    const elem = this.mainAppContainer.nativeElement;

    if (!document.fullscreenElement) {
      // Entrar en pantalla completa
      elem.requestFullscreen().catch((err: any) => {
        console.warn(`[SpainGraph] Error al intentar pantalla completa: ${err.message}`);
      });
    } else {
      // Salir de pantalla completa
      document.exitFullscreen();
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen = !!document.fullscreenElement;

    // Le damos un pequeño respiro para que Angular aplique las clases CSS
    // y forzamos a Cesium a recalcular su tamaño para que no se estire raro.
    setTimeout(() => {
      this.viewer?.resize();
      this.viewer?.scene.requestRender();
    }, 100);
  }

  get capitalsSorted(): Capital[] {
    return [...this.capitals].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  get canCalculate(): boolean {
    return !!this.selectedOrigin && !!this.selectedDestination && !this.isRouting;
  }

  resetRoute(): void {
    this.route = null;
    this.selectedOrigin = '';
    this.selectedDestination = '';
    this.rebuildMap();
  }

  private loadGraph(): void {
    this.isLoading = true;
    this.errorMsg = '';

    this.gs.getGraph().subscribe({
      next: async (data) => {
        this.graph = data;
        this.capitals = data.nodes;

        try {
          await this.initCesium();
          this.rebuildMap();
        } catch (error) {
          this.errorMsg = 'No se pudo inicializar el mapa GIS de Espana.';
          console.error('[SpainGraph] Cesium init error:', error);
        }

        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMsg = 'No se pudo conectar con el backend. Verifica que el servidor este activo.';
        this.isLoading = false;
        this.cdr.detectChanges();
        console.error('[SpainGraph] loadGraph error:', err);
      },
    });
  }

  private async initCesium(): Promise<void> {
    if (!this.graph) return;

    this.viewer?.destroy();
    this.viewer = new Viewer(this.mapHostRef.nativeElement, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      creditContainer: this.cesiumCreditsRef.nativeElement,
      scene3DOnly: true,
      shouldAnimate: false,
    });

    // Forzamos resolución nativa para que no se vea pixelado
    this.viewer.resolutionScale = window.devicePixelRatio || 1.0;

    // --- 1. AÑADIMOS EL RELIEVE 3D ---
    try {
      this.viewer.terrainProvider = await createWorldTerrainAsync();
    } catch (err) {
      console.warn('[SpainGraph] No se pudo cargar el terreno 3D', err);
    }

    const { scene } = this.viewer;

    // --- 2. ACTIVAR PROFUNDIDAD PARA LAS MONTAÑAS ---
    // Cambiamos false por true. Si está en false, verás las líneas a través de las montañas.
    scene.globe.depthTestAgainstTerrain = true;

    // --- 3. PERMITIR INCLINAR LA CÁMARA ---
    // Cambiamos false por true para poder rotar la vista en 3D (Botón derecho del ratón + arrastrar)
    scene.screenSpaceCameraController.enableTilt = true;
    scene.screenSpaceCameraController.enableLook = true;

    scene.screenSpaceCameraController.minimumZoomDistance = 500;
    scene.screenSpaceCameraController.maximumZoomDistance = 6_000_000;

    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;

    await this.applyBasemap();

    // Volamos a España, pero inclinamos un poco la cámara para que el relieve se note de inmediato
    this.viewer.camera.flyTo({
      destination: SPAIN_RECTANGLE,
      duration: 0,
      orientation: {
        heading: 0,
        pitch: CesiumMath.toRadians(-90), // <-- Inclinado a 65 grados en lugar de -90 (totalmente plano)
        roll: 0,
      },
    });

    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => {
      this.viewer?.resize();
      this.viewer?.scene.requestRender();
    });
    this.resizeObs.observe(this.mapHostRef.nativeElement);

    const handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);

    handler.setInputAction((click: any) => {
      // 1. Miramos qué objeto 3D hay debajo del ratón
      if (!this.viewer) return;
      const pickedObject = this.viewer.scene.pick(click.position);

      // 2. Si tocamos una entidad y tiene un ID (el ID de la capital)
      if (defined(pickedObject) && pickedObject.id && pickedObject.id.id) {
        const capitalId = pickedObject.id.id;

        // 3. Volvemos al "mundo Angular" para actualizar variables
        this.ngZone.run(() => {
          this.handleNodeClick(capitalId);
        });
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  private async applyBasemap(): Promise<void> {
    if (!this.viewer) return;

    const token = ++this.basemapLoadToken;

    try {
      const provider = await ArcGisMapServerImageryProvider.fromUrl(
        BASEMAPS[this.basemapStyle].url,
      );
      if (!this.viewer || token !== this.basemapLoadToken) return;

      this.viewer.imageryLayers.removeAll();
      this.viewer.imageryLayers.addImageryProvider(provider);
      this.viewer.scene.requestRender();
      this.errorMsg = '';
      this.cdr.markForCheck();
    } catch (error) {
      if (token !== this.basemapLoadToken) return;

      this.errorMsg = 'No se pudo cargar la capa cartografica seleccionada.';
      console.error('[SpainGraph] basemap error:', error);
      this.cdr.markForCheck();
    }
  }

  private rebuildMap(): void {
    if (!this.viewer || !this.graph) return;

    // 1. Borrar todo el mapa para evitar líneas duplicadas
    this.viewer.entities.removeAll();

    const pathSet = new Set(this.route?.path ?? []);

    // 2. Pintar los nodos
    this.addCapitalEntities(pathSet);

    // 3. Pintar SIEMPRE la red azul (el grafo)
    this.addGraphEdges(this.graph.edges);

    // 4. Si hay una ruta calculada, la pintamos por encima
    if (this.route?.path.length) {
      this.addRouteEntities(this.route.path, pathSet);
    }

    this.viewer.scene.requestRender();
  }

  private handleNodeClick(capitalId: string): void {
    // Caso 1: Nada seleccionado -> Elegimos Origen
    if (!this.selectedOrigin) {
      this.selectedOrigin = capitalId;
    }
    // Caso 2: Origen seleccionado, pero no Destino -> Elegimos Destino
    else if (!this.selectedDestination && capitalId !== this.selectedOrigin) {
      this.selectedDestination = capitalId;
    }
    // Caso 3: Ya había ruta o estaban los dos -> Reiniciamos y empezamos por el Origen
    else {
      this.selectedOrigin = capitalId;
      this.selectedDestination = '';

      // Si ya había una ruta calculada, la borramos
      if (this.route) {
        this.resetRoute();
      }
    }

    // Disparamos tu función para que se repinten los colores en el mapa
    this.onSelectionChange();

    // Forzamos a Angular a actualizar los combobox del HTML
    this.cdr.markForCheck();
  }

  private addCapitalEntities(pathSet: Set<string>): void {
    if (!this.viewer || !this.graph) return;

    // Comprobamos si actualmente hay una ruta mostrándose
    const hasRoute = !!this.route;

    for (const cap of this.graph.nodes) {
      // Ahora las comprobaciones de color dependen de si existe una ruta
      const isOrigin = cap.id === this.selectedOrigin;
      const isDestination = cap.id === this.selectedDestination;
      const isPath = pathSet.has(cap.id);

      const height = cap.population / 60;

      const basePosition = Cartesian3.fromDegrees(cap.lng, cap.lat, 0);

      const color = isOrigin
        ? Color.fromCssColorString('#f59e0b')
        : isDestination
          ? Color.fromCssColorString('#f43f5e')
          : isPath
            ? Color.fromCssColorString('#fbbf24')
            : Color.fromCssColorString('#2dd4bf');

      const pixelSize = isOrigin || isDestination ? 16 : isPath ? 13 : 10;

      this.viewer.entities.add({
        id: cap.id,
        position: basePosition,
        cylinder: {
          length: height, // Altura total del cilindro
          topRadius: 6000.0, // Radio superior (4km para que sea visible)
          bottomRadius: 6000.0, // Radio inferior
          material: color,
          outline: true,
          outlineColor: Color.WHITE.withAlpha(0.7),
          outlineWidth: 1.0,
          // Esto hace que se apoye en el relieve (montañas/valles)
          heightReference: HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: `${cap.name}\n${cap.population.toLocaleString()} hab.`,
          show: isOrigin || isDestination || isPath,
          font: 'bold 13px "Segoe UI", sans-serif',
          fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          verticalOrigin: VerticalOrigin.BOTTOM,
          // Desplazamos la etiqueta por encima del cilindro
          pixelOffset: new Cartesian2(0, -15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }

  private addGraphEdges(edges: GraphEdge[]): void {
    if (!this.viewer || !this.graph) return;

    const nodeMap = new Map(this.graph.nodes.map((node) => [node.id, node]));

    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      this.viewer.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray([source.lng, source.lat, target.lng, target.lat]),
          width: 3.5, // Un poco más gruesa
          clampToGround: true,
          // Un material con borde para que la línea quede definida y no "borrosa"
          material: new PolylineOutlineMaterialProperty({
            color: Color.fromCssColorString('#3b82f6').withAlpha(0.7), // Azul principal
            outlineWidth: 1.0,
            outlineColor: Color.fromCssColorString('#1e3a8a').withAlpha(0.8), // Borde azul oscuro
          }),
        },
      });
    }
  }

  private addRouteEntities(path: string[], pathSet: Set<string>): void {
    if (!this.viewer || !this.graph || path.length < 2) return;

    const nodeMap = new Map(this.graph.nodes.map((node) => [node.id, node]));
    const degrees: number[] = [];

    // Recopilamos todas las coordenadas de la ruta en orden
    for (const id of path) {
      const cap = nodeMap.get(id);
      if (!cap) continue;
      degrees.push(cap.lng, cap.lat);
    }

    if (degrees.length < 4) return; // Se necesitan mínimo 4 valores (lng1, lat1, lng2, lat2)

    // Dibujamos la línea de la ruta principal superpuesta al grafo azul
    this.viewer.entities.add({
      id: 'route-main',
      polyline: {
        positions: Cartesian3.fromDegreesArray(degrees),
        // Para que el brillo se note, la línea debe ser más ancha (ej. 10 a 12)
        width: 12.0,
        clampToGround: true,
        // Efecto neón rojo/naranja
        material: new PolylineGlowMaterialProperty({
          glowPower: 0.25, // Intensidad del brillo (entre 0 y 1)
          taperPower: 1,
          color: Color.fromCssColorString('#ef4444'), // Rojo vibrante
        }),
        zIndex: 10,
      },
    });

    // Dibujamos los anillos decorativos sobre cada parada
    for (const id of pathSet) {
      const cap = nodeMap.get(id);
      if (!cap) continue;

      this.viewer.entities.add({
        id: `route-ring-${id}`,
        position: Cartesian3.fromDegrees(cap.lng, cap.lat, 0),
        ellipse: {
          semiMajorAxis: 12_000,
          semiMinorAxis: 12_000,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          material: Color.fromCssColorString('#ef4444').withAlpha(0.22),
          outline: true,
          outlineColor: Color.fromCssColorString('#fecaca').withAlpha(0.95),
          outlineWidth: 2,
        },
      });
    }
  }
}
