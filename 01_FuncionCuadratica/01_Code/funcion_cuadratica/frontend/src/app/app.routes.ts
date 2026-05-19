import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'paraboloide',
    pathMatch: 'full'
  },
  {
    path: 'paraboloide',
    loadComponent: () =>
      import('./features/paraboloide-hiperbolico/paraboloide-hiperbolico.component.ts')
        .then(m => m.ParaboloideHiperbolicoComponent)
  }
];