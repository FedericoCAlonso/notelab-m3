export const DEFAULT_REACTIVE_DOC_PATH = 'memoria-electrica.md';

export const WELCOME_REACTIVE_DOC_CONTENT = `# Memoria de Cálculo y Presupuesto — Circuito de Taller

Documento técnico reactivo en **texto plano Markdown**. Modificá cualquier dato de las tablas o fórmulas (tocando o presionando \`Enter\`) y todo el informe se recalcula en cascada automáticamente.

\`\`\`calc @oculto
@unidad ARS = 1/1200 USD
@unidad rollo = 100 m
iva = 0.21
\`\`\`

## 1. Parámetros Eléctricos del Circuito

Consideramos una alimentación monofásica de [V: 220 V | input min=110 max=380 step=10] con una corriente de diseño de [I: 4.5 A | slider 0.5..20 step=0.5] y factor de potencia [fp: 0.92 | select 0.8, 0.85, 0.92, 1.0].

\`\`\`calc
S = V * I -> W
P = V * I * fp -> W
P_kw = P -> kW @formula
E_diaria = P_kw * 8 h -> kWh
\`\`\`

La potencia activa estimada es {{P}} ({{P_kw}}), lo que representa un consumo diario de {{E_diaria}}:

$$P = {{V}} \\cdot {{I}} \\cdot {{fp}} = {{P}}$$

\`\`\`mermaid
flowchart LR
  Red["Red ({{V}})"] --> Carga["Corriente {{I}} · cos φ = {{fp}}"] --> Pot["Potencia: {{P}} ({{E_diaria}}/día)"]
\`\`\`

## 2. Lista de Materiales y Presupuesto

Las columnas **Subtotal** y **Total** se definen por campo (\`@col\`) y se actualizan automáticamente al cambiar cantidades, precios o el IVA.

@tabla: materiales
@col Subtotal = Cantidad * Precio
@col Total = Subtotal * (1 + iva)

| Ítem | Cantidad | Precio | Subtotal | Total |
| :--- | :---: | :---: | :---: | :---: |
| Cable unipolar 2.5 mm² | 100 m | 1.2 USD/m | — | — |
| Llave térmica 16 A | 4 u | 18 USD/u | — | — |
| Disyuntor diferencial | 1 u | 42 USD/u | — | — |
| Gabinete DIN 8 bocas | 1 u | 35 USD/u | — | — |

### 2.1 Resumen Económico

\`\`\`calc
subtotal_mat = sum(materiales.Subtotal) @resultado
total_usd = sum(materiales.Total) @resultado
total_ars = total_usd -> ARS @formula
\`\`\`

El costo total de materiales con IVA incluido asciende a **{{total_usd}}** (equivalente a {{total_ars}} según la cotización declarada en el bloque oculto).

\`\`\`plot
titulo: Distribución de costos — Total {{total_usd}}
tabla: materiales
x: Ítem
y: Total
tipo: barras
\`\`\`

### 2.2 Gráfico con Python + Matplotlib (opcional con Termux)

Si tenés el servidor Jupyter de Termux encendido, podés ejecutar este bloque: las variables (\`V\`, \`I\`, \`P\`, \`total_usd\`) y la tabla \`materiales\` (como \`pandas.DataFrame\`) se inyectan automáticamente.

\`\`\`python
import matplotlib.pyplot as plt

items = list(materiales["Ítem"])
totales = list(materiales["Total"])

plt.figure(figsize=(6.2, 2.8))
plt.barh(items, totales, color="#4f6ef7")
plt.xlabel(f"Total con IVA [{materiales_unidades.get('Total', 'USD')}]")
plt.title(f"Presupuesto (Total: {total_usd:.2f} USD · Potencia: {P:.1f} W)")
plt.grid(axis="x", alpha=0.3)
plt.tight_layout()
plt.show()
\`\`\`
`;

export function createEmptyReactiveDocTemplate(title: string): string {
  const cleanTitle = title.replace(/\.md$/i, '').trim() || 'Nueva Nota Técnica';
  return `# ${cleanTitle}

## 1. Datos Iniciales

Definí parámetros inline como {{V := 220 V}} o en un bloque \`calc\`:

\`\`\`calc
I = 2.5 A
P = V * I -> W
\`\`\`

La potencia resultante es {{P}}.

## 2. Tabla de Ítems

@tabla: items
@col Subtotal = Cantidad * Precio

| Concepto | Cantidad | Precio | Subtotal |
| :--- | :---: | :---: | :---: |
| Ítem A | 2 u | 15 USD/u | — |

\`\`\`calc
total = sum(items.Subtotal) @resultado
\`\`\`
`;
}
