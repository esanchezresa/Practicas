# Interfaz grafica de funciones cuadraticas

Proyecto base funcional sin three.js, con:

- Frontend: Angular
- Backend: FastAPI (Python)
- Calculo de la funcion cuadratica en backend
- Parametros editables con campo de texto y barra deslizante
- Grafica interactiva (zoom y paneo)

## Estructura

- frontend: aplicacion Angular
- backend: API en Python
- package.json en la raiz: arranque combinado del proyecto

## 1) Arranque rapido desde la raiz

Instala las dependencias una vez:

```powershell
Set-Location "c:\Users\eder.sanchez\OneDrive - SENER\Ejercicios\funcion_cuadratica"
npm install
```

Luego arranca todo con un solo comando:

```powershell
npm start
```

Eso levanta el backend en `http://127.0.0.1:8000` y el frontend en `http://localhost:4200`.

Health check del backend:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health"
```

Si prefieres arrancarlos por separado, tambien puedes usar:

```powershell
Set-Location "c:\Users\eder.sanchez\OneDrive - SENER\Ejercicios\funcion_cuadratica\backend"
& ".\.venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

```powershell
Set-Location "c:\Users\eder.sanchez\OneDrive - SENER\Ejercicios\funcion_cuadratica\frontend"
npm start
```

## 2) Uso rapido

- Cambia a, b y c con el numero o el slider.
- La grafica se recalcula automaticamente.
- Usa rueda del mouse para zoom.
- Arrastra para mover la vista.
- Boton "Reset vista" para volver al encuadre inicial.

## API principal

- POST /api/quadratic/calculate

Ejemplo de payload:

```json
{
  "a": 1,
  "b": -3,
  "c": 2,
  "x_min": -10,
  "x_max": 10,
  "samples": 240
}
```
