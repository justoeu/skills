# Escrita de tasks após o SDD

Leia esta referência ao transformar o SDD confirmado em tasks ou revisar uma task
aberta. Aplique uma adaptação prática dos princípios do ASD-STE100, cerca de 80% do
caminho pedido pelo usuário. Esse percentual indica intensidade de adoção, não uma
nota de conformidade. Preserve o idioma do projeto; português é válido.

## Forma de escrever

- Use voz ativa. Nas instruções, use um verbo direto: “Valide”, “Rejeite”, “Preserve”,
  “Registre”. No título, use verbo + objeto + condição relevante.
- Escreva uma instrução por frase. Use passos separados quando a ordem importar.
  Uma task pode conter vários passos que entregam o mesmo resultado verificável.
- Prefira frases curtas. Cerca de 20 palavras por instrução é uma orientação,
  não um bloqueio automático. Preserve condições e precisão ao simplificar.
- Use o mesmo termo para o mesmo conceito. Mantenha nomes de campos, rotas, classes,
  comandos e códigos de erro exatamente como definidos no SDD ou no código.
- Coloque a condição antes da ação: “Se a sessão expirou, recuse a operação.”
- Nomeie o componente ou ator quando houver mais de um possível responsável.
  Substitua “isso”, “o mesmo” e “tratar adequadamente” pelo objeto e resultado concretos.
- Separe a ação do contexto e do resultado esperado. Notas explicam; passos mandam
  executar; critérios de aceite descrevem algo que um teste ou check pode observar.

Não imponha o dicionário inglês do STE a termos de software ou à redação portuguesa.
Não traduza identificadores. Não remova uma negação, exceção, unidade ou limite para
encurtar a frase. Não invente requisitos para completar um modelo de task.

## Conteúdo no contrato existente

Use os campos que os consumidores do pack já conhecem:

| Campo | Conteúdo |
|---|---|
| `title` | Ação específica e objeto. Evite “Ajustes gerais” ou “Melhorar a API”. |
| `slice` | Responsabilidade e limite da entrega; cite componentes conhecidos. |
| `description` | Contexto necessário, precondições do SDD e passos em ordem. |
| `acceptance` | Lista de resultados observáveis, um por item, com cenário e resultado. |
| `refs` | IDs de requisitos ou seções precisas do SDD que sustentam a task. |
| `depends_on` | IDs de tasks produtoras; não esconda dependências apenas na descrição. |
| `validation` | `red-green`, `characterization` ou `check`, conforme a mudança. |

Preencha descrição e aceite nas tasks novas. Escolha casos negativos, limites e
preservação de comportamento conforme o contrato; não exija os mesmos casos em todas
as tasks. Para `check`, registre também `kind` e `validation_reason`. Comandos sugeridos
não são evidência executada: `red`, `green`, `checks` e resultados vêm da implementação.

`TASKS.json` continua sendo a fonte. Gere o Markdown a partir dele; não mantenha uma
especificação mais completa só no Markdown. Packs antigos continuam legíveis, sem
reabrir tarefas concluídas para uma revisão de estilo. Ao retomar, melhore as tasks
abertas que estiverem ambíguas. Uma mudança de significado exige rever dependências,
contratos e evidências afetadas; uma revisão editorial não amplia o SDD.

## Exemplo

Suponha que RF-07 determine: `POST /jobs/{id}/cancel` retorna 409 quando o job está
`COMPLETED`, sem alterar o job nem emitir evento. A frase “Ajustar cancelamento e
garantir que tudo funcione corretamente” não identifica esse contrato.

```json
{
  "id": "T-007",
  "title": "Rejeite o cancelamento de jobs concluídos",
  "slice": "Validação do cancelamento no serviço de jobs existente.",
  "description": "Consulte o estado do job antes de cancelar.\nSe o estado for COMPLETED, retorne o erro definido em RF-07.\nPreserve o fluxo dos demais estados.",
  "acceptance": [
    "Com o job em COMPLETED, POST /jobs/{id}/cancel retorna HTTP 409.",
    "Após a recusa, o estado do job continua COMPLETED.",
    "A recusa não emite evento de cancelamento."
  ],
  "refs": ["RF-07"],
  "depends_on": [],
  "worktree": 1,
  "status": "OPEN",
  "version": 0,
  "validation": "red-green",
  "tests_added": 0,
  "red_green": false,
  "immutability": false
}
```

Os valores desse exemplo pertencem ao contrato hipotético. Não os transfira para
outro projeto. Se o SDD não definir a resposta de erro, registre a lacuna material
antes de inventar um status, payload ou efeito.

## Revisão antes do despacho

O planner confere se cada task responde: o que mudar, onde, em qual condição, como
observar o resultado e qual requisito autoriza isso. Separe entregas que possam ser
validadas independentemente; mantenha juntos os passos necessários para um contrato.
Não crie uma task por frase, arquivo ou verbo.

O spec reviewer compara os critérios com o SDD e com o comportamento implementado.
“Testes passam”, sozinho, não define aceite. “Sem erros” e “melhor performance”
precisam de resultado ou medida já definidos no contrato. Resolva ambiguidade material;
não bloqueie entrega apenas por tamanho de frase ou preferência editorial.

Fonte dos princípios linguísticos: [FAQ oficial do ASD-STE100](https://www.asd-ste100.org/STE_faq.html).
A estrutura de tasks acima é uma adaptação deste harness, sem alegação de certificação STE.
