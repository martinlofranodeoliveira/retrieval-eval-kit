# Retrieval Eval Kit

Biblioteca TypeScript e CLI originais para avaliação offline de `Recall@K`, `MRR@K`, acerto de fonte (`HitRate@K`) e decisões de resposta/abstenção em casos de recuperação rotulados. Por [Lofrano Tecnologia](https://lofranotecnologia.com.br). A página oficial [LOFRANO IA](https://lofranotecnologia.com.br/servicos/inteligencia-artificial) oferece contexto institucional, não comprovação de resultados desta avaliação.

[English](./README.md)

## Instalação, testes e demonstração

Requer Node.js `>=22`. TypeScript e os tipos do Node são dependências apenas de desenvolvimento; não há dependências de runtime.

```bash
npm install
npm test
npm run demo
```

`npm test` compila em modo estrito antes de executar `node --test`. Após a instalação, os testes e a demonstração não precisam de rede, modelos, embeddings, chaves de API ou datasets baixados. A demonstração escreve apenas em stdout e verifica diferenças fixas entre métricas sintéticas.

## CLI

```bash
npm run cli -- examples/retrieval.json --k 3 --format json
npm run cli -- examples/retrieval.json --k 3 --format markdown
```

Para stdout contendo somente o relatório, sem as mensagens de scripts do npm:

```bash
npm run build
node dist/src/cli.js examples/retrieval.json --k 3 --format json
```

Pode-se usar `--input <caminho>` em vez do caminho posicional. JSON é o formato padrão; `md` é um alias de `markdown`. Opções repetidas são rejeitadas. Use `--help` sozinho. Prefixe com `./` um caminho iniciado por `-`. A saída é `0` para uma avaliação válida ou ajuda, e `2` para erro de uso, entrada ou I/O. Pontuações baixas, por si só, não são erro.

## Exemplo da biblioteca

Compile antes de importar o JavaScript:

```bash
npm run build
```

Em um arquivo `.mjs` na raiz deste repositório:

```js
import { evaluateRetrieval, formatMarkdownReport } from './dist/src/index.js';

const report = evaluateRetrieval({
  version: 1,
  corpusDocIds: ['doc-1', 'doc-2'],
  queries: [{
    id: 'q-1',
    relevantDocIds: ['doc-2'],
    rankedDocIds: ['doc-1', 'doc-2'],
    decision: 'abstain'
  }]
}, 2);

console.log(report.retrieval.mrrAtK); // 0.5, mesmo com abstenção
console.log(report.decision.falseAbstentionCount); // 1
process.stdout.write(formatMarkdownReport(report));
```

Consumidores do pacote podem importar as mesmas funções de `retrieval-eval-kit`. Também são exportadas `parseDatasetJson`, `validateDataset`, `loadDatasetFromFile`, `evaluateDatasetFile`, `compareRetrievalDatasets`, `formatJsonReport` e `formatComparisonMarkdown`. Falhas de validação geram `ValidationError` com `code`. Arrays do chamador não são modificados.

## Fórmulas exatas

Para cada consulta, `R` é o conjunto de IDs relevantes únicos e `P` contém os primeiros `min(K, rankedDocIds.length)` IDs ranqueados. `K` deve ser inteiro seguro e finito em `1..1000`.

Para consultas **respondíveis** (`R.length > 0`):

- `hits = |R ∩ P|`.
- `recallAtK = hits / R.length`.
- `reciprocalRankAtK = 1 / primeiraPosiçãoRelevante`, com posição iniciando em 1 dentro de `P`, ou `0` se não houver acerto.
- `hitAtK = 1` se `hits > 0`, senão `0`.

Os agregados `recallAtK`, `mrrAtK` e `hitRateAtK` são as médias aritméticas simples das respectivas métricas sobre **apenas as consultas respondíveis**, independentemente das decisões fornecidas. Consultas sem resposta têm métricas individuais de recuperação `null`. Sem consultas respondíveis, os três agregados são `null` e `answerableQueryCount` é `0`.

A decisão é avaliada separadamente em **todas** as consultas. A decisão esperada é `abstain` somente quando `R` é vazio; caso contrário é `answer`. Falsa resposta significa responder a uma consulta sem resposta; falsa abstenção significa abster-se em uma consulta respondível. A acurácia é `correctCount / totalQueries`, ou `null` quando não há consultas. Portanto, a entrada com consultas vazias retorna médias de recuperação e acurácia `null`, não médias zero.

JSON preserva os resultados numéricos binary64 do JavaScript, sem arredondamento adicional; não usa aritmética racional de precisão arbitrária. Markdown usa `toFixed(4)` e representa nulos como `null`. A ordem das consultas é preservada. Relatórios omitem textos dos documentos e das perguntas. Caracteres de sintaxe nos IDs são codificados como entidades no Markdown, sem interpretá-los como tabelas, links ou HTML.

## Exemplo calculado manualmente

`examples/synthetic-corpus.json` contém dez trechos inventados e seis perguntas com rótulos manuais. Esse arquivo serve de contexto e **não** é uma entrada do avaliador. Os dois arquivos de rankings usam os mesmos IDs e rótulos.

Para `examples/retrieval.json` com `K=3`:

| Consulta | Relevantes | Posições relevantes até K | Recall | RR | Hit |
| --- | --- | --- | --- | --- | --- |
| q-01 | 1 | 1 | 1 | 1 | 1 |
| q-02 | 2 | 2, 3 | 1 | 0.5 | 1 |
| q-03 | 2 | 1 | 0.5 | 1 | 1 |
| q-04 | 1 | nenhuma; relevante na posição 4 | 0 | 0 | 0 |
| q-05 | 0 | nenhuma | null | null | null |
| q-06 | 0 | nenhuma | null | null | null |

Recall@3 é `(1 + 1 + 0.5 + 0)/4 = 0.625`; MRR@3 é `(1 + 0.5 + 1 + 0)/4 = 0.625`; HitRate@3 é `3/4 = 0.75`. A única decisão incorreta do candidato é q-04, logo a acurácia é `5/6 = 0.8333333333333334` (`0.8333` em Markdown).

A seção legível da demonstração é:

```text
# Retrieval Ranking Comparison (K = 3)

- **Corpus Size**: 10 | **Total Queries**: 6 (4 answerable, 2 unanswerable)

| Metric | Baseline | Candidate | Delta |
| --- | --- | --- | --- |
| Recall@3 | 0.3750 | 0.6250 | +0.2500 |
| MRR@3 | 0.1667 | 0.6250 | +0.4583 |
| HitRate@3 | 0.5000 | 0.7500 | +0.2500 |
| Decision Accuracy | 0.5000 | 0.8333 | +0.3333 |
| False Answers | 1 | 0 | -1 |
| False Abstentions | 2 | 1 | -1 |
```

Em seguida, a seção `Machine-Readable Comparison JSON` apresenta valores completos de baseline, candidato e diferença. Essas diferenças são aritmética de fixtures, não resultados de clientes nem benchmarks.

## Decisões de projeto e limitações

A separação entre ranking e decisão permite observar recuperação correta com abstenção incorreta. Consultas sem resposta são excluídas dos denominadores de recuperação para não misturar esses dois problemas. IDs explícitos e limites fixos mantêm a implementação pequena e offline.

Apenas a versão 1 é aceita: um objeto JSON estrito, sem propriedades desconhecidas, nomes de propriedades repetidos ou IDs duplicados. Os limites incluem 1 MiB de entrada bruta, representação compacta validada de até 1 MiB também para objetos JavaScript, 10.000 documentos, 5.000 consultas, 1.000 IDs ranqueados por consulta e 128 unidades UTF-16 por ID. A leitura aceita arquivos locais regulares. Consulte o [contrato completo](./docs/contract.md), incluindo regras de codificação e alinhamento das comparações.

A ferramenta **não** recupera documentos, examina respostas geradas, avalia verdade semântica, factualidade, alucinações, segurança ou prontidão para produção, nem fornece garantia automática de qualidade. Os resultados dependem dos rótulos fornecidos. Somente relevância binária é suportada. Não há intervalos de confiança ou testes de significância. A API de objetos não é uma sandbox para proxies JavaScript executáveis. Arquivos alterados durante a leitura não formam um snapshot atômico.

- [Design e justificativas](./docs/design.md)
- [Contrato e campos de saída](./docs/contract.md)
- [Contribuição](./CONTRIBUTING.md)
- [Relato de vulnerabilidades](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

Para contato geral, use o [site oficial](https://lofranotecnologia.com.br).

Licença MIT. Copyright (c) 2026 Lofrano Tecnologia.
