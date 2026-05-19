# Proyecto: Visualizador 3D Interactivo de Funciones Cuadráticas

## 1. Descripción General

Este es un proyecto completo de visualización y análisis interactivo de funciones cuadráticas (f(x) = ax² + bx + c). Combina un backend Python (FastAPI) con un frontend Angular que utiliza Three.js para renderizar gráficos 3D interactivos con soporte para edición en tiempo real mediante nodos arrastrables.

**Características principales:**
- Visualización 3D de parábolas con Three.js
- Edición interactiva: arrastra 3 nodos para modificar los coeficientes
- Cálculos matemáticos en el backend (todos los cálculos se centralizan en backend)
- Interfaz responsive con controles deslizantes y entrada numérica
- Cálculo automático de discriminante, raíces y vértice
- Soporte CORS para desarrollo local

---

## 2. Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                    Cliente (Navegador)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Angular 21 - Componentes Standalone              │   │
│  │  - App (control principal)                        │   │
│  │  - QuadraticChart (renderizado 3D con Three.js)  │   │
│  │  - QuadraticControls (entrada de parámetros)     │   │
│  │  - AppHeader (encabezado)                         │   │
│  └──────────────────────────────────────────────────────┘   │
│              ↓ (HTTP POST requests)                          │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                 Servidor (Backend)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  FastAPI + Uvicorn (Python)                        │   │
│  │  - POST /api/quadratic/calculate                   │   │
│  │    Entrada: (a, b, c, x_min, x_max, samples)      │   │
│  │    Salida: puntos, discriminante, raíces, vértice │   │
│  │                                                     │   │
│  │  - POST /api/quadratic/fit-from-points            │   │
│  │    Entrada: (p1, p2, p3, x_min, x_max)            │   │
│  │    Salida: coeficientes calculados + datos        │   │
│  │                                                     │   │
│  │  - GET /api/health                                │   │
│  │    Verifica si el servidor está activo            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Stack Tecnológico

### Backend
- **Python 3.x** con **FastAPI**
- **Uvicorn** como servidor ASGI
- **Pydantic** para validación de datos
- **CORS Middleware** para permitir requests desde localhost

### Frontend
- **Angular 21** (componentes standalone)
- **TypeScript** en modo strict
- **Three.js (~0.184)** para renderizado 3D
  - `OrbitControls` para rotación/zoom de cámara
  - `Raycaster` para detección de clics en nodos
  - `TubeGeometry` para visualizar curva como tubo 3D
  - `GridHelper`, `AxesHelper` para referencias visuales
- **RxJS** para manejo de observables
- **Reactive Forms** de Angular
- **Angular HTTP Client** para comunicación con backend

### Herramientas de Build/Dev
- **npm** (gestión de dependencias frontend)
- **Angular CLI** (`ng build`, `ng serve`)
- **concurrently** (ejecución simultánea de backend y frontend)

---

## 4. Estructura de Directorios

```
funcion_cuadratica/
├── backend/
│   ├── __init__.py
│   ├── main.py                          # FastAPI app con todos los endpoints
│   └── requirements.txt                 # Dependencias Python
├── frontend/
│   ├── src/
│   │   ├── index.html                   # HTML raíz
│   │   ├── main.ts                      # Bootstrap de Angular
│   │   ├── styles.scss                  # Estilos globales
│   │   └── app/
│   │       ├── app.ts                   # Componente raíz, lógica principal
│   │       ├── app.html                 # Template raíz
│   │       ├── app.scss                 # Estilos de app
│   │       ├── app.config.ts            # Configuración de Angular (providers)
│   │       ├── app.routes.ts            # Rutas (vacío, SPA única página)
│   │       ├── components/
│   │       │   ├── app-header/          # Encabezado con título/descripción
│   │       │   ├── quadratic-controls/  # Panel de entrada (sliders + números)
│   │       │   └── quadratic-chart/     # Visor 3D con nodos arrastrables
│   │       └── services/
│   │           └── quadratic-api.service.ts  # Cliente HTTP para API
│   ├── angular.json                     # Config de Angular CLI
│   ├── tsconfig.json                    # Config TypeScript
│   ├── package.json                     # Dependencias npm
│   └── dist/                            # Salida de build (ng build)
├── package.json                         # Scripts para ejecutar todo
├── README.md                            # Documentación original
└── PROYECTO_COMPLETO.md                 # Este archivo
```

---

## 5. Flujo de Datos Principal

### 5.1 Carga Inicial

1. **Usuario carga la página**
   - Angular bootstrap en `main.ts` → `app.ts`
   
2. **Componente `App` constructor (`app.ts`)**
   - Define formulario reactivo con valores por defecto: a=1, b=0, c=0, xMin=-5, xMax=5
   - Llama a `applyLocalComputation()` para cálculos iniciales locales
   - Llama a `fetchQuadratic()` para obtener puntos del backend
   - Se suscribe a cambios en el formulario:
     - **Cambios inmediatos**: trigger `applyLocalComputation()` (actualizacion de UI instantánea)
     - **Cambios con debounce (140ms)**: trigger `fetchQuadratic()` (datos definitivos del backend)

3. **Backend recibe POST `/api/quadratic/calculate`**
   - Recibe: a, b, c, x_min, x_max, samples
   - Calcula: 240 puntos en la curva, discriminante, raíces, vértice
   - Retorna: estructura `QuadraticResponse`

4. **Frontend actualiza la escena 3D**
   - `ngOnChanges()` detecta cambio en `@Input() points`
   - Llama `updateCurveFromInput()` → crea TubeGeometry, actualiza cámara
   - Crea 3 nodos esféricos (azul oscuro) en posiciones: izquierda, centro, derecha

### 5.2 Cambio de Parámetros Manual (Sliders/Input)

```
Usuario ajusta slider "a" (0 a 10)
    ↓
form.valueChanges emite nuevo valor
    ↓
Inmediato: applyLocalComputation()
  - Recalcula puntos localmente (JS)
  - Actualiza discriminante, raíces, vértice
  - Cambia curvePoints → dispara ngOnChanges en chart
  - Chart se redibuja (instant, sin spinner)
    ↓
Con debounce 140ms: fetchQuadratic()
  - Envía a backend para validación/precisión
  - Muestra spinner "Calculando..."
  - Backend retorna puntos oficiales
  - Chart se actualiza con datos backend
```

### 5.3 Edición Interactiva (Arrastra Nodos)

**Flujo completo:**

1. **Usuario presiona sobre un nodo** (`pointerdown`)
   - `onPointerDown()` en chart.ts
   - Raycaster detecta qué nodo fue clickeado
   - `isDragging = true` (previene recreación de nodos)
   - OrbitControls se desactivan (no rotar mientras arrastras)

2. **Usuario mueve el mouse** (`pointermove`)
   - `onPointerMove()` actualiza posición del nodo
   - Calcula intersección mouse→plano z=0 usando Raycaster
   - Nodo sigue el mouse en tiempo real

3. **Usuario suelta el mouse** (`pointerup`)
   - `onPointerUp()` ejecuta:
     ```typescript
     api.fitCoefficientsFromPoints({
       p1: {x, y},   // nodo izquierdo
       p2: {x, y},   // nodo central
       p3: {x, y},   // nodo derecho
       x_min: min(p1.x, p3.x),
       x_max: max(p1.x, p3.x)
     })
     ```
   - Backend calcula a, b, c resolviendo sistema lineal (Cramer's rule)
   - Backend retorna coeficientes + puntos + discriminante + raíces
   - `coefficientsChange.emit()` → emite al padre

4. **Padre (`app.ts`) recibe evento** (`onChartCoefficientsChange`)
   ```typescript
   onChartCoefficientsChange(payload) {
     form.patchValue({a, b, c, xMin, xMax})  // actualiza formulario
     fetchQuadratic()                          // fetch backend para puntos
   }
   ```

5. **Resultado final**
   - Curva se redibuja con nuevos coeficientes
   - Panel de controles muestra nuevos valores
   - Estadísticas (discriminante, raíces, vértice) se actualizan
   - Nodos se recrean en nuevas posiciones de puntos

---

## 6. Endpoints API

### `POST /api/quadratic/calculate`

**Propósito:** Calcular puntos de la curva y estadísticas

**Request:**
```json
{
  "a": 1.0,
  "b": 0.0,
  "c": -5.0,
  "x_min": -5,
  "x_max": 5,
  "samples": 240
}
```

**Response:**
```json
{
  "points": [
    {"x": -5, "y": 20},
    {"x": -4.9, "y": 19.01},
    ...
  ],
  "discriminant": 20.0,
  "has_real_roots": true,
  "roots": [-2.236, 2.236],
  "vertex_x": 0,
  "vertex_y": -5
}
```

---

### `POST /api/quadratic/fit-from-points`

**Propósito:** Calcular coeficientes a, b, c desde 3 puntos de la parábola

**Request:**
```json
{
  "p1": {"x": -5, "y": 20},
  "p2": {"x": 0, "y": -5},
  "p3": {"x": 5, "y": 20},
  "x_min": -5,
  "x_max": 5
}
```

**Response:**
```json
{
  "a": 1.0,
  "b": 0.0,
  "c": -5.0,
  "discriminant": 20.0,
  "roots": [-2.236, 2.236],
  "vertex_x": 0,
  "vertex_y": -5
}
```

**Algoritmo (backend):**
- Resuelve sistema Vandermonde: [x₁² x₁ 1] [a]   [y₁]
                                 [x₂² x₂ 1] [b] = [y₂]
                                 [x₃² x₃ 1] [c]   [y₃]
- Usa Cramer's rule para estabilidad numérica
- Retorna `None` si el sistema es singular (3 puntos colineales)

---

### `GET /api/health`

**Propósito:** Verificar que el servidor está activo

**Response:**
```json
{
  "status": "ok"
}
```

---

## 7. Componentes Angular

### 7.1 `App` (app.ts)

**Responsabilidad:** Lógica principal, orquestación de datos

**Propiedades:**
- `form: FormGroup` → formulario reactivo con controles a, b, c, xMin, xMax
- `curvePoints: Point[]` → puntos de la curva para renderizar
- `roots: number[]` → raíces de la ecuación
- `vertexX, vertexY` → coordenadas del vértice
- `discriminant` → discriminante (b² - 4ac)
- `isLoading` → flag para mostrar spinner
- `hasError` → flag para mostrar error de conectividad

**Métodos clave:**
- `fetchQuadratic()` → POST al backend `/calculate`, actualiza todos los datos
- `applyLocalComputation()` → Cálculos locales inmediatos (JS puro)
- `onChartCoefficientsChange()` → Handler para eventos de edición interactiva
- `buildPoints()` → Genera array de puntos en el rango [xMin, xMax]
- `solveRoots()` → Resuelve raíces usando fórmula cuadrática

---

### 7.2 `QuadraticChart` (quadratic-chart.component.ts)

**Responsabilidad:** Renderizado 3D con Three.js y manejo de interacción

**Inputs:**
- `points: Point[]` → Puntos de la curva
- `roots: number[]` → Raíces (para marcar)
- `vertexX, vertexY` → Vértice (para marcar)
- `isLoading` → Muestra texto "Calculando..."
- `xMin, xMax` → Rango para contexto

**Outputs:**
- `coefficientsChange: EventEmitter<{a, b, c, xMin, xMax}>` → Emitido al soltar un nodo

**Three.js Scene:**
- **Scene background** color `#f8fcfc` (blanco suave)
- **Lighting:**
  - AmbientLight intensidad 1.6 (iluminación uniforme)
  - DirectionalLight intensidad 2.2 en posición (8, 12, 10)
- **Grid** 40x20 unidades, colores gris suave
- **Axes** para referencia (12 unidades)
- **Curve** representada como TubeGeometry (tubo 3D con radio 0.14)
  - Material: MeshStandardMaterial con color `#2dd4bf` (turquesa)
  - Opacidad 0.88, roughness 0.35
- **Markers:**
  - Vértice: esfera roja (#d9480f)
  - Raíces: esferas marrón (#b45309)
  - Nodos arrastrables: esferas azul oscuro (#1e40af, radio 0.30)

**Manejo de Interacción:**
- **Raycaster** para detectar clics en nodos
- **Plane (z=0)** para calcular posición del mouse en 3D
- **PointerCapture** para capturar eventos de mouse
- **isDragging flag** para evitar recreación de nodos durante arrastre

**Lifecycle:**
- `ngAfterViewInit()` → Inicializa escena, crea handlers, renderiza
- `ngOnChanges()` → Actualiza curva cuando cambian puntos
- `ngOnDestroy()` → Limpia recursos (Three.js, event listeners)

---

### 7.3 `QuadraticControls` (quadratic-controls.component.ts)

**Responsabilidad:** Interfaz de entrada

**Inputs:**
- `form: FormGroup` → Formulario reactivo
- `discriminant, rootsDisplay, vertexX, vertexY` → Resultados
- `hasError` → Flag de error

**Características:**
- Input numérico + slider para cada parámetro
- Rango slider: a ∈ [-10, 10], b ∈ [-20, 20], c ∈ [-30, 30]
- Step: 0.1 para precisión
- Panel de estadísticas (discriminante, vértice, raíces)
- Mensaje de error si backend no responde

---

### 7.4 `AppHeader` (app-header.component.ts)

**Responsabilidad:** Encabezado informativo

**Inputs:**
- `title` → Título del proyecto
- `description` → Descripción de instrucciones

---

## 8. Servicio API

### `QuadraticApiService` (quadratic-api.service.ts)

```typescript
export class QuadraticApiService {
  private baseUrl = `${window.location.protocol}//${window.location.hostname}:8000`

  calculate(payload: QuadraticRequest): Observable<QuadraticResponse>
  
  fitCoefficientsFromPoints(payload: CoefficientsFromPointsRequest): Observable<CoefficientsResponse>
}
```

**Estrategia de host:**
- Detecta automáticamente protocolo (`http` o `https`)
- Usa `window.location.hostname` (localhost en desarrollo)
- Puerto fijo 8000 (backend)
- Ejemplo: `http://localhost:8000` o `http://127.0.0.1:8000`

---

## 9. Configuración Backend

### `main.py`

**Configuración CORS:**
```python
CORSMiddleware(
  allow_origins=[],  # Vacio (usar regex)
  allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)
```
Permite solicitudes desde cualquier puerto en `localhost` o `127.0.0.1`.

**Funciones matemáticas clave:**

- `quadratic(a, b, c, x)` → Calcula f(x) = ax² + bx + c

- `solve_roots(a, b, c, discriminant)` → Resuelve raíces:
  - Si a=0: ecuación lineal
  - Si discriminant < 0: sin raíces reales
  - Si discriminant = 0: raíz única
  - Si discriminant > 0: dos raíces

- `solve_coefficients_from_three_points(x1, y1, x2, y2, x3, y3)` → Resuelve a, b, c:
  - Construye matriz Vandermonde
  - Usa Cramer's rule
  - Retorna None si sistema singular

---

## 10. Instrucciones de Ejecución

### Requisitos
- Python 3.8+ con pip y venv
- Node.js 16+ con npm
- Navegador moderno (Chrome, Firefox, Edge)

### Instalación

**Backend:**
```bash
cd backend
python -m venv venv
source venv/Scripts/activate  # En Windows
pip install -r requirements.txt
```

**Frontend:**
```bash
cd frontend
npm install
```

### Ejecución

**Opción 1: Concurrently (recomendado)**
```bash
npm start
# Inicia backend (uvicorn) + frontend (ng serve) simultáneamente
# Backend: http://127.0.0.1:8000
# Frontend: http://localhost:[puerto dinámico]
```

**Opción 2: Manual**

Terminal 1 (Backend):
```bash
cd backend
source .venv/Scripts/activate
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Terminal 2 (Frontend):
```bash
cd frontend
npm start
# o: ng serve --port 4200
```

### Build para producción
```bash
npm run build:frontend
# Genera dist/frontend/
```

---

## 11. Problemas Conocidos y Soluciones

### Problema 1: npm start falla con puerto 4200 en uso
**Solución:** Script usa `--port 0` para puerto dinámico
```json
"start:frontend": "ng serve --port 0"
```

### Problema 2: Chart muestra "Calculando..." pero no actualiza
**Solución:** Implementado `applyLocalComputation()` como fallback local

### Problema 3: Nodos se saltan al arrastrar
**Solución:** Flag `isDragging` previene recreación de nodos durante arrastre

### Problema 4: Backend rechaza requests del frontend
**Solución:** CORS configurado para acepar localhost + cualquier puerto

### Problema 5: TypeScript strict mode rechaza tipos de Three.js
**Solución:** Instalada `@types/three` y conversiones de tipo explícitas

---

## 12. Detalles Técnicos Importantes

### Actualización de Nodos
- **Antes de arrastre:** Nodos se recrean cuando cambia `points` (new positions)
- **Durante arrastre:** Flag `isDragging` previene recreación
- **Después de soltar:** Nodos se recrean con nuevas posiciones calculadas

### Cálculo de Coeficientes
- **Fronted (LOCAL, obsoleto):** Removido. Era rápido pero incorrecto si se requiere backend
- **Backend (ACTUAL):** Matriz Vandermonde + Cramer's rule
  - Ventaja: Cálculos centralizados, auditables
  - Desventaja: Latencia de red (mitigada con predicción local)

### Renderizado 3D
- **CatmullRomCurve3:** Interpolación suave entre puntos
- **TubeGeometry:** Tubo 3D alrededor de la curva (más visual que línea)
- **OrbitControls:** Rotación libre + zoom
- **ResizeObserver:** Adapta canvas a tamaño ventana

---

## 13. Características Futuras Posibles

1. **Historial de ediciones** → Almacenar ecuaciones anteriores
2. **Exportar gráfico** → PNG/PDF del renderizado
3. **Modo de derivadas** → Mostrar f'(x) superpuesta
4. **Temas oscuro/claro** → Toggle de colores
5. **Multiples funciones** → Comparar parábolas
6. **Validación de rango** → Evitar valores fuera de límites
7. **Animaciones** → Transiciones suaves al cambiar parámetros
8. **Precisión ajustable** → Slider para número de muestras (points)

---

## 14. Notas para Otro LLM

### Contexto Global
Este proyecto implementa un **editor gráfico 3D interactivo** con arquitectura **frontend-backend separada**. La decisión clave es que **todos los cálculos matemáticos residen en backend** para cumplir requisitos de auditoría/validación.

### Flujo de Edición Interactiva (lo más complejo)
1. Usuario arrastra nodo → `pointerdown` captura
2. Mientras arrastra → nodo sigue mouse (z=0)
3. Al soltar → 3 posiciones → backend → `fitCoefficientsFromPoints()`
4. Backend retorna a, b, c
5. Padre recibe evento → `patchForm()` → `fetchQuadratic()`
6. Backend retorna curva completa con nuevos coeficientes
7. Chart redibuja con nuevos puntos + recrea nodos

### Optimizaciones Implementadas
- **Debounce en form:** 140ms para evitar excessive fetch
- **isDragging flag:** Previene jitter durante arrastre
- **Local fallback:** UI responsiva incluso sin backend

### Tecnologías Críticas
- **Three.js:** Curva como TubeGeometry (suave, 3D)
- **Raycaster:** Detección de clics en nodos
- **Angular Reactive Forms:** Flujo predecible de cambios
- **FastAPI:** Documentación automática (Swagger en /docs)
- **Pydantic:** Validación automática de tipos

---

## 15. Glosario

| Término | Definición |
|---------|-----------|
| **Curva** | f(x) = ax² + bx + c, visualizada como tubo 3D |
| **Nodos** | Esferas azules arrastrables que representan 3 puntos en la curva |
| **Vértice** | Punto máximo/mínimo de la parábola (-b/2a, f(-b/2a)) |
| **Discriminante** | Δ = b² - 4ac, determina naturaleza de raíces |
| **Raíces** | Valores de x donde f(x) = 0 |
| **Orbitcontrols** | Control de cámara (rotación, zoom) |
| **Raycaster** | Herramienta de Three.js para detectar intersecciones 3D-2D |
| **Plane** | Plano z=0 en el que se proyecta el mouse |
| **isLoading** | Flag que muestra/oculta spinner "Calculando..." |
| **isDragging** | Flag que previene recreación de nodos durante arrastre |

---

**Última actualización:** 28 de Abril de 2026
**Versión del proyecto:** 1.0.0 (Funcional)
**Estado:** ✅ Producción lista

