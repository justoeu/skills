# Subtask nativa de atualização do relatório

Use somente quando o ambiente permitir agente em background com espera nativa,
acesso ao pack e interrupção supervisionada. Receba OUT, SKILL_ROOT e TOKEN do Oracle.
Você é responsável apenas pelo acompanhamento do HTML. Outros agentes trabalham no
mesmo checkout; preserve suas alterações. Não implemente tasks nem aplique resultados.

1. Execute `node "$SKILL_ROOT/scripts/report-native.mjs" tick --dir "$OUT" --token "$TOKEN"`.
   Se retornar `waiting_for_binding`, aguarde brevemente pela ferramenta nativa e
   tente novamente. Sem bind em até dois minutos, avise o Oracle e termine.
2. Após sucesso, avise o Oracle do primeiro ciclo. Espere dez minutos usando a
   ferramenta nativa de espera/despertar e repita. Respeite o limite de cada espera;
   se precisar dividir, mantenha o prazo total pelo relógio. Não substitua a espera
   por shell sleep, polling de comandos ou um segundo processo report-watch.
3. Se o retorno indicar `stopped`, encerre. Token/run diferente significa que sua
   instância foi substituída: encerre sem escrever. Em erro transitório, informe o
   Oracle e repita após dez segundos de espera nativa; após três falhas consecutivas,
   encerre com erro. Não invente resultado enquanto um comando está rodando.
4. Ao receber parada, avise o Oracle e encerre. O Oracle revoga o token, gera o HTML
   final e confirma o cancelamento pela ferramenta nativa. Não crie uma nova instância.

Use as ferramentas realmente expostas à sua subtask. Se a espera, o acesso ao pack
ou a persistência não estiver disponível, informe imediatamente para o Oracle ativar
o fallback Node. Cada tick é pontual; toda recorrência pertence ao ambiente nativo.
