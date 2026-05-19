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
} from '@angular/core';
import {
  AmbientLight,
  AxesHelper,
  BufferGeometry,
  Color,
  DirectionalLight,
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
  WebGLRenderer,
  Material,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface View2d { xMin: number; xMax: number; yMin: number; yMax: number; }

@Component({
  selector: 'app-function-line-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './function-line-chart.component.html',
  styleUrl: './function-line-chart.component.scss'
})
export class FunctionLineChartComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('canvasHost', { static: true }) private canvasHost?: ElementRef<HTMLDivElement>;
  @ViewChild('canvas2d',   { static: true }) private canvas2dEl?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartWrap',  { static: true }) private chartWrapEl?: ElementRef<HTMLDivElement>;

  @Input({ required: true }) points: Array<{ x: number; y: number }> = [];
  @Input() isLoading = false;
  @Input() expression = '';
  @Input() xMin = -10;
  @Input() xMax = 10;

  /** Emitted when the user repositions a control node and a new formula is derived. */
  @Output() expressionChange = new EventEmitter<string>();

  viewMode: '2d' | '3d' = '2d';
  yMin: number | null = null;
  yMax: number | null = null;

  // ── Three.js ─────────────────────────────────────────────────────────────
  private scene?: Scene;
  private camera?: PerspectiveCamera;
  private renderer?: WebGLRenderer;
  private controls?: OrbitControls;
  private readonly curveMaterial = new LineBasicMaterial({ color: '#0d9488' });
  private curveLine?: Line<BufferGeometry, LineBasicMaterial>;
  private needsRender = true;
  private renderFrameId: number | null = null;
  private resizeObserver?: ResizeObserver;
  private lastViewCenter = new Vector3(0, 0, 0);
  private lastViewSize = 10;
  private didAutofit = false;

  // ── 3-node spline editor ─────────────────────────────────────────────────
  // Three nodes: left (xMin), centre, right (xMax). x is fixed; only y is draggable.
  private nodeHandles: Mesh[]    = [];   // the sphere meshes
  private nodeXValues: number[]  = [];   // locked x positions [xMin, mid, xMax]
  private nodeYValues: number[]  = [];   // current y positions (drag updates these)
  private nodesReady    = false;
  private nodesManual   = false;  // true once user has dragged at least one node
  private lastEmittedExpr = '';   // used to detect external expression changes

  private dragTarget: Mesh | null = null;
  private readonly raycaster = new Raycaster();
  private readonly mouse     = new Vector2();

  private readonly nodeMat      = new MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  private readonly nodeHoverMat = new MeshBasicMaterial({ color: 0xffd700, depthTest: false });
  private readonly nodeGeo      = new SphereGeometry(0.22, 14, 10);

  // ── 2D canvas ────────────────────────────────────────────────────────────
  private view2d: View2d = { xMin: -11, xMax: 11, yMin: -8, yMax: 8 };
  private isDragging2d   = false;
  private dragStart      = { x: 0, y: 0 };
  private dragViewStart: View2d = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };

  private readonly onControlsChange = (): void => { this.requestRender(); };

  // ════════════════════════════════════════════════════════════════════════
  //  Angular lifecycle
  // ════════════════════════════════════════════════════════════════════════

  ngAfterViewInit(): void {
    this.initializeScene();
    this.refreshSceneFromInputs();
    if (this.viewMode === '2d') {
      this.setupCanvas2dListeners();
      this.fitView2d();
      requestAnimationFrame(() => this.draw2d());
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // If the expression was changed externally (user typed) reset manual flag
    if (changes['expression'] && !changes['expression'].firstChange) {
      const newExpr = changes['expression'].currentValue as string;
      if (newExpr !== this.lastEmittedExpr) {
        this.nodesManual = false;
      }
    }
    // Reset nodes if domain changes
    if ((changes['xMin'] || changes['xMax']) && !changes['xMin']?.firstChange) {
      this.nodesManual = false;
    }

    if (changes['points']) {
      if (this.scene) this.refreshSceneFromInputs();
      if (this.viewMode === '2d') {
        this.fitView2d();
        // Defer draw until the browser has completed layout.
        // This prevents clientWidth=0 when ngOnChanges fires mid-CD cycle.
        requestAnimationFrame(() => this.draw2d());
      }
    }
  }

  ngOnDestroy(): void {
    this.teardownScene();
    this.teardownCanvas2dListeners();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Public UI actions
  // ════════════════════════════════════════════════════════════════════════

  toggleMode(): void {
    this.viewMode = this.viewMode === '3d' ? '2d' : '3d';
    if (this.viewMode === '2d') {
      this.setupCanvas2dListeners();
      this.fitView2d();
      requestAnimationFrame(() => this.draw2d());
    } else {
      this.teardownCanvas2dListeners();
      if (this.controls) this.controls.enabled = true;
      requestAnimationFrame(() => { this.resizeRenderer(); this.positionCamera(); this.requestRender(); });
    }
  }

  resetZoom(): void {
    if (this.viewMode === '2d') { this.fitView2d(); this.draw2d(); return; }
    this.positionCamera();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  2D Canvas renderer
  // ════════════════════════════════════════════════════════════════════════

  private setupCanvas2dListeners(): void {
    const c = this.canvas2dEl?.nativeElement; if (!c) return;
    c.addEventListener('wheel',        this.onWheel2d,      { passive: false });
    c.addEventListener('pointerdown',  this.onPointerDown2d);
    c.addEventListener('pointermove',  this.onPointerMove2d);
    c.addEventListener('pointerup',    this.onPointerUp2d);
    c.addEventListener('pointercancel',this.onPointerUp2d);
  }

  private teardownCanvas2dListeners(): void {
    const c = this.canvas2dEl?.nativeElement; if (!c) return;
    c.removeEventListener('wheel',        this.onWheel2d);
    c.removeEventListener('pointerdown',  this.onPointerDown2d);
    c.removeEventListener('pointermove',  this.onPointerMove2d);
    c.removeEventListener('pointerup',    this.onPointerUp2d);
    c.removeEventListener('pointercancel',this.onPointerUp2d);
  }

  private fitView2d(): void {
    const f = this.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!f.length) { this.view2d = { xMin: -10, xMax: 10, yMin: -8, yMax: 8 }; return; }
    const xs = f.map(p => p.x), ys = f.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    this.view2d = {
      xMin: x0 - Math.max((x1-x0)*.06, .5), xMax: x1 + Math.max((x1-x0)*.06, .5),
      yMin: y0 - Math.max((y1-y0)*.12, .5), yMax: y1 + Math.max((y1-y0)*.12, .5),
    };
  }

  private draw2d(attempt = 0): void {
    const canvas = this.canvas2dEl?.nativeElement; if (!canvas) return;
    const ctx = canvas.getContext('2d');          if (!ctx)    return;
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (!cssW || !cssH) {
      // Canvas not yet laid out — retry once after the browser paints
      if (attempt < 4) requestAnimationFrame(() => this.draw2d(attempt + 1));
      return;
    }
    const pxW = Math.round(cssW*dpr), pxH = Math.round(cssH*dpr);
    if (canvas.width!==pxW || canvas.height!==pxH) { canvas.width=pxW; canvas.height=pxH; }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const W=cssW, H=cssH;
    const {xMin,xMax,yMin,yMax} = this.view2d;
    const xR=xMax-xMin, yR=yMax-yMin;
    const toSX=(x:number)=>(x-xMin)/xR*W;
    const toSY=(y:number)=>H-(y-yMin)/yR*H;

    ctx.fillStyle='#fffef8'; ctx.fillRect(0,0,W,H);

    const stepX=this.niceStep(xR), stepY=this.niceStep(yR);
    ctx.strokeStyle='#d4e4e8'; ctx.lineWidth=.7; ctx.beginPath();
    for (let gx=Math.ceil(xMin/stepX-.001)*stepX; gx<=xMax+stepX*.001; gx=parseFloat((gx+stepX).toPrecision(10)))
      { ctx.moveTo(toSX(gx),0); ctx.lineTo(toSX(gx),H); }
    for (let gy=Math.ceil(yMin/stepY-.001)*stepY; gy<=yMax+stepY*.001; gy=parseFloat((gy+stepY).toPrecision(10)))
      { ctx.moveTo(0,toSY(gy)); ctx.lineTo(W,toSY(gy)); }
    ctx.stroke();

    ctx.strokeStyle='#374151'; ctx.lineWidth=1.5;
    if (yMin<=0&&yMax>=0){ctx.beginPath();ctx.moveTo(0,toSY(0));ctx.lineTo(W,toSY(0));ctx.stroke();}
    if (xMin<=0&&xMax>=0){ctx.beginPath();ctx.moveTo(toSX(0),0);ctx.lineTo(toSX(0),H);ctx.stroke();}

    ctx.font=`10.5px -apple-system,"Segoe UI",system-ui,sans-serif`;
    ctx.fillStyle='#374151';
    const sy0=yMin>0?H-2:yMax<0?2:toSY(0);
    const sx0=xMin>0?2:xMax<0?W-2:toSX(0);
    ctx.textBaseline='top'; ctx.textAlign='center';
    for (let gx=Math.ceil(xMin/stepX-.001)*stepX; gx<=xMax+stepX*.001; gx=parseFloat((gx+stepX).toPrecision(10))) {
      ctx.strokeStyle='#374151'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(toSX(gx),sy0-3); ctx.lineTo(toSX(gx),sy0+3); ctx.stroke();
      if (Math.abs(gx)>stepX*.01) ctx.fillText(this.fmtTick(gx,stepX),toSX(gx),Math.min(sy0+5,H-14));
    }
    ctx.textBaseline='middle'; ctx.textAlign='right';
    for (let gy=Math.ceil(yMin/stepY-.001)*stepY; gy<=yMax+stepY*.001; gy=parseFloat((gy+stepY).toPrecision(10))) {
      ctx.strokeStyle='#374151'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(sx0-3,toSY(gy)); ctx.lineTo(sx0+3,toSY(gy)); ctx.stroke();
      if (Math.abs(gy)>stepY*.01) ctx.fillText(this.fmtTick(gy,stepY),Math.max(sx0-5,32),toSY(gy));
    }
    if (xMin<=0&&xMax>=0&&yMin<=0&&yMax>=0){
      ctx.textBaseline='top'; ctx.textAlign='right';
      ctx.fillText('0',Math.max(toSX(0)-4,14),Math.min(toSY(0)+4,H-14));
    }

    const f=this.points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    if (f.length>1){
      ctx.strokeStyle='#0d9488'; ctx.lineWidth=3.5; ctx.lineJoin='round'; ctx.lineCap='round';
      ctx.beginPath(); let pen=false, psy=0;
      for (const pt of f){
        const sx=toSX(pt.x), sy=toSY(pt.y);
        if (!pen){ctx.moveTo(sx,sy);pen=true;}
        else if (Math.abs(sy-psy)>H*2){ctx.moveTo(sx,sy);}
        else{ctx.lineTo(sx,sy);}
        psy=sy;
      }
      ctx.stroke();
    }
  }

  private niceStep(range:number):number{
    const e=Math.floor(Math.log10(Math.abs(range/7)||1));
    const p=Math.pow(10,e), f=(range/7)/p;
    return f<1.5?p:f<3.5?2*p:f<7.5?5*p:10*p;
  }
  private fmtTick(v:number,step:number):string{
    return v.toFixed(Math.max(0,-Math.floor(Math.log10(Math.abs(step)||1))));
  }

  private readonly onWheel2d=(e:WheelEvent):void=>{
    e.preventDefault();
    const c=this.canvas2dEl?.nativeElement; if(!c) return;
    const r=c.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top, W=c.clientWidth, H=c.clientHeight;
    const {xMin,xMax,yMin,yMax}=this.view2d;
    const wx=xMin+mx/W*(xMax-xMin), wy=yMin+(H-my)/H*(yMax-yMin);
    const k=e.deltaY>0?1.12:1/1.12;
    this.view2d={xMin:wx+(xMin-wx)*k,xMax:wx+(xMax-wx)*k,yMin:wy+(yMin-wy)*k,yMax:wy+(yMax-wy)*k};
    this.draw2d();
  };
  private readonly onPointerDown2d=(e:PointerEvent):void=>{
    this.isDragging2d=true; this.dragStart={x:e.clientX,y:e.clientY};
    this.dragViewStart={...this.view2d};
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  private readonly onPointerMove2d=(e:PointerEvent):void=>{
    if(!this.isDragging2d) return;
    const c=this.canvas2dEl?.nativeElement; if(!c) return;
    const dx=e.clientX-this.dragStart.x, dy=e.clientY-this.dragStart.y;
    const W=c.clientWidth, H=c.clientHeight;
    const xR=this.dragViewStart.xMax-this.dragViewStart.xMin;
    const yR=this.dragViewStart.yMax-this.dragViewStart.yMin;
    this.view2d={
      xMin:this.dragViewStart.xMin-dx/W*xR, xMax:this.dragViewStart.xMax-dx/W*xR,
      yMin:this.dragViewStart.yMin+dy/H*yR, yMax:this.dragViewStart.yMax+dy/H*yR,
    };
    this.draw2d();
  };
  private readonly onPointerUp2d=():void=>{ this.isDragging2d=false; };

  // ════════════════════════════════════════════════════════════════════════
  //  Three.js scene
  // ════════════════════════════════════════════════════════════════════════

  private initializeScene(): void {
    const host = this.canvasHost?.nativeElement; if (!host) return;

    this.scene = new Scene();
    this.scene.background = new Color('#f8fcfc');
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const dl = new DirectionalLight(0xffffff, 2.2);
    dl.position.set(8,12,10); this.scene.add(dl);

    this.camera = new PerspectiveCamera(45, 1, 0.1, 3000);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
    const wrap = this.chartWrapEl?.nativeElement;
    const initW = (wrap?.clientWidth  || host.clientWidth)  || 800;
    const initH = (wrap?.clientHeight || host.clientHeight) || 500;
    this.renderer.setSize(initW, initH, false);
    host.innerHTML = '';
    host.appendChild(this.renderer.domElement);

    const grid = new GridHelper(40, 20, 0x89a9ad, 0xd8e5e8);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);
    this.scene.add(new AxesHelper(12));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.maxDistance     = 300;
    this.controls.minDistance     = 0.45;
    this.controls.addEventListener('change', this.onControlsChange);

    this.curveLine = new Line(new BufferGeometry(), this.curveMaterial);
    this.scene.add(this.curveLine);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDownNode);
    canvas.addEventListener('pointermove', this.onPointerMoveNode);
    canvas.addEventListener('pointerup',   this.onPointerUpNode);

    this.resizeObserver = new ResizeObserver(() => this.onContainerResize());
    this.resizeObserver.observe(wrap ?? host);

    this.positionCamera();
  }

  private onContainerResize(): void {
    if (this.viewMode === '2d') { this.draw2d(); } else { this.resizeRenderer(); }
  }

  // ── 3D data refresh ──────────────────────────────────────────────────────

  private refreshSceneFromInputs(): void {
    if (!this.scene) return;
    const pts = this.points.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));

    if (pts.length < 2) {
      this.replaceCurveGeometry([]);
      this.clearNodeHandles();
      this.yMin = this.yMax = null;
      this.requestRender(); return;
    }

    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
    this.yMin = Math.min(...ys);
    this.yMax = Math.max(...ys);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    this.lastViewCenter = new Vector3((xMin+xMax)/2, (this.yMin+this.yMax)/2, 0);
    this.lastViewSize   = Math.max(xMax-xMin, this.yMax-this.yMin, 8);

    if (!this.nodesManual) {
      // First load or external expression change — rebuild nodes from data
      this.buildNodesFromData(pts);
    }
    // Always redraw the curve from current node positions
    this.updateCurveFromNodes();

    if (!this.didAutofit) { this.positionCamera(); this.didAutofit = true; }
    this.requestRender();
  }

  // ── Node management ──────────────────────────────────────────────────────

  /**
   * Places 3 node handles at x = xMin, mid, xMax.
   * Y values are sampled from the evaluated data.
   */
  private buildNodesFromData(pts: {x:number;y:number}[]): void {
    this.clearNodeHandles();
    if (pts.length < 2) return;

    const x0 = pts[0].x;
    const x2 = pts[pts.length - 1].x;
    const x1 = (x0 + x2) / 2;

    this.nodeXValues = [x0, x1, x2];
    this.nodeYValues = [
      this.sampleY(pts, x0),
      this.sampleY(pts, x1),
      this.sampleY(pts, x2),
    ];

    for (let i = 0; i < 3; i++) {
      const sphere = new Mesh(this.nodeGeo, this.nodeMat.clone());
      sphere.position.set(this.nodeXValues[i], this.nodeYValues[i], 0);
      sphere.renderOrder = 999;
      this.scene!.add(sphere);
      this.nodeHandles.push(sphere);
    }
    this.nodesReady = true;
  }

  /** Nearest-neighbour y lookup in sorted points array. */
  private sampleY(pts: {x:number;y:number}[], x: number): number {
    let best = pts[0], bestDist = Math.abs(pts[0].x - x);
    for (const p of pts) {
      const d = Math.abs(p.x - x);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best.y;
  }

  private clearNodeHandles(): void {
    for (const h of this.nodeHandles) {
      this.scene?.remove(h);
      (h.material as Material).dispose();
    }
    this.nodeHandles  = [];
    this.nodeXValues  = [];
    this.nodeYValues  = [];
    this.nodesReady   = false;
  }

  /**
   * Fits a quadratic through the 3 nodes, then samples 300 points in [x0,x2]
   * and updates the 3D curve geometry.
   */
  private updateCurveFromNodes(): void {
    if (!this.nodesReady || this.nodeXValues.length < 3) return;
    const [x0,x1,x2] = this.nodeXValues;
    const [y0,y1,y2] = this.nodeYValues;
    const {a,b,c} = this.fitQuadratic(x0,y0, x1,y1, x2,y2);
    const N = 300;
    const pts: Vector3[] = [];
    for (let i=0; i<=N; i++) {
      const x = x0 + (x2-x0) * i/N;
      pts.push(new Vector3(x, a*x*x + b*x + c, 0));
    }
    this.replaceCurveGeometry(pts);
  }

  // ── Drag handlers ────────────────────────────────────────────────────────

  private readonly onPointerDownNode = (e: PointerEvent): void => {
    if (!this.nodesReady || !this.renderer || !this.camera || this.viewMode !== '3d') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(
      ((e.clientX-rect.left)/rect.width)*2-1,
      -((e.clientY-rect.top)/rect.height)*2+1
    );
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.nodeHandles);
    if (hits.length > 0) {
      this.dragTarget = hits[0].object as Mesh;
      this.dragTarget.material = this.nodeHoverMat.clone();
      this.controls!.enabled = false;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
    }
  };

  private readonly onPointerMoveNode = (e: PointerEvent): void => {
    if (!this.dragTarget || !this.renderer || !this.camera || !this.controls) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(
      ((e.clientX-rect.left)/rect.width)*2-1,
      -((e.clientY-rect.top)/rect.height)*2+1
    );
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Intersect with a plane facing the camera, at the node position
    const planeNormal = new Vector3()
      .subVectors(this.camera.position, this.controls.target).normalize();
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, this.dragTarget.position);
    const hit = new Vector3();
    if (this.raycaster.ray.intersectPlane(plane, hit)) {
      // Lock x — only allow vertical (y) movement
      const idx = this.nodeHandles.indexOf(this.dragTarget);
      if (idx >= 0) {
        hit.x = this.nodeXValues[idx];  // locked x
        hit.z = 0;
        this.dragTarget.position.copy(hit);
        this.nodeYValues[idx] = hit.y;
        this.updateCurveFromNodes();
        this.emitFormula();
      }
    }
  };

  private readonly onPointerUpNode = (): void => {
    if (this.dragTarget) {
      this.dragTarget.material = this.nodeMat.clone();
      this.dragTarget = null;
    }
    if (this.controls) this.controls.enabled = true;
  };

  // ── Quadratic fit & formula ───────────────────────────────────────────────

  /**
   * Returns (a, b, c) such that f(x) = a·x² + b·x + c passes through
   * all three given points. Uses Lagrange interpolation expanded to standard form.
   */
  private fitQuadratic(
    x0:number, y0:number,
    x1:number, y1:number,
    x2:number, y2:number
  ): { a:number; b:number; c:number } {
    const d0=(x0-x1)*(x0-x2);
    const d1=(x1-x0)*(x1-x2);
    const d2=(x2-x0)*(x2-x1);
    const a = y0/d0 + y1/d1 + y2/d2;
    const b = -(y0*(x1+x2)/d0 + y1*(x0+x2)/d1 + y2*(x0+x1)/d2);
    const c = y0*x1*x2/d0 + y1*x0*x2/d1 + y2*x0*x1/d2;
    return { a, b, c };
  }

  /**
   * Converts (a, b, c) coefficients to a human-readable expression string
   * that the backend evaluator understands: e.g. "1.5*x^2 - 3*x + 2"
   */
  private buildFormula(a:number, b:number, c:number): string {
    const round = (n:number) => {
      const r = Math.round(n * 10000) / 10000;
      return Number.isInteger(r) ? r.toString() : r.toString();
    };
    const parts: string[] = [];

    if (Math.abs(a) > 1e-9) {
      const s = a < 0 ? '-' : '';
      const v = round(Math.abs(a));
      parts.push(Math.abs(a)===1 ? `${s}x^2` : `${s}${v}*x^2`);
    }
    if (Math.abs(b) > 1e-9) {
      const sign = b < 0 ? (parts.length ? ' - ' : '-') : (parts.length ? ' + ' : '');
      const v = round(Math.abs(b));
      parts.push(Math.abs(b)===1 ? `${sign}x` : `${sign}${v}*x`);
    }
    if (Math.abs(c) > 1e-9 || parts.length === 0) {
      const sign = c < 0 ? (parts.length ? ' - ' : '-') : (parts.length ? ' + ' : '');
      parts.push(`${sign}${round(Math.abs(c))}`);
    }
    return parts.join('') || '0';
  }

  private emitFormula(): void {
    if (!this.nodesReady || this.nodeXValues.length < 3) return;
    const [x0,x1,x2] = this.nodeXValues;
    const [y0,y1,y2] = this.nodeYValues;
    const {a,b,c} = this.fitQuadratic(x0,y0, x1,y1, x2,y2);
    const formula = this.buildFormula(a, b, c);
    this.nodesManual      = true;
    this.lastEmittedExpr  = formula;
    this.expressionChange.emit(formula);
  }

  // ── Geometry / renderer helpers ──────────────────────────────────────────

  private replaceCurveGeometry(points: Vector3[]): void {
    if (!this.curveLine) return;
    const prev = this.curveLine.geometry;
    const next  = new BufferGeometry();
    next.setFromPoints(points);
    this.curveLine.geometry = next;
    prev.dispose();
  }

  private positionCamera(): void {
    if (!this.camera || !this.controls) return;
    const d = Math.max(this.lastViewSize * 1.08, 4.5);
    this.camera.position.set(
      this.lastViewCenter.x + d*.74, d*.64, this.lastViewCenter.z + d*.76
    );
    this.controls.target.copy(this.lastViewCenter);
    this.controls.update();
    this.requestRender();
  }

  private resizeRenderer(): void {
    if (!this.renderer || !this.camera) return;
    const host = this.chartWrapEl?.nativeElement ?? this.canvasHost?.nativeElement;
    if (!host) return;
    const W = Math.max(host.clientWidth, 1), H = Math.max(host.clientHeight, 1);
    this.camera.aspect = W/H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H, false);
    this.requestRender();
  }

  private requestRender(): void {
    this.needsRender = true;
    if (this.renderFrameId !== null) return;
    this.renderFrameId = requestAnimationFrame(() => this.renderFrame());
  }

  private renderFrame(): void {
    this.renderFrameId = null;
    if (!this.renderer||!this.scene||!this.camera||!this.controls||!this.needsRender) return;
    this.needsRender = false;
    const again = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (again || this.needsRender) this.requestRender();
  }

  private teardownScene(): void {
    if (this.renderFrameId !== null) { cancelAnimationFrame(this.renderFrameId); this.renderFrameId=null; }
    this.resizeObserver?.disconnect();
    this.controls?.removeEventListener('change', this.onControlsChange);
    this.controls?.dispose(); this.controls=undefined;
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDownNode);
      this.renderer.domElement.removeEventListener('pointermove', this.onPointerMoveNode);
      this.renderer.domElement.removeEventListener('pointerup',   this.onPointerUpNode);
    }
    this.clearNodeHandles();
    this.nodeGeo.dispose(); this.nodeMat.dispose(); this.nodeHoverMat.dispose();
    if (this.curveLine) {
      this.scene?.remove(this.curveLine);
      this.curveLine.geometry.dispose();
      this.curveLine=undefined;
    }
    this.curveMaterial.dispose();
    this.renderer?.dispose(); this.renderer?.domElement.remove(); this.renderer=undefined;
    this.scene=undefined; this.camera=undefined;
  }
}
