import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { PRODUCT_NAME } from '../supabase/functions/_shared/config.ts'
import './index.css'
import { AppLayout } from './pages/AppLayout.tsx'
import { ClientsPage, InvoicePage, InvoicesPage, ProjectsPage, TimePage } from './pages/Archive.tsx'
import { ExportPage } from './pages/ExportPage.tsx'
import { ImportPage } from './pages/ImportPage.tsx'
import { Landing, SignIn } from './pages/Landing.tsx'
import { ReconcilePage } from './pages/ReconcilePage.tsx'

document.title = `${PRODUCT_NAME} · Import your Harvest account`

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/signin', element: <SignIn /> },
  {
    path: '/app',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="import" replace /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'reconcile', element: <ReconcilePage /> },
      { path: 'clients', element: <ClientsPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'time', element: <TimePage /> },
      { path: 'invoices', element: <InvoicesPage /> },
      { path: 'invoices/:id', element: <InvoicePage /> },
      { path: 'export', element: <ExportPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
