# Roadmap

Where the port stands, and what's been discussed for later. See [CREDITS.md](CREDITS.md)
for attribution and [README.md](README.md) for usage.

## Concluído (v0.1.0 → v0.2.6)

### Núcleo do módulo
- Geometria do hexágono, zonas de terreno misto e pontos de âncora de estrada/rio
  portados 1:1 do Python original (`scripts/geometry.js`).
- Fronteira de zona por cancelamento combinatório de arestas, sem dependência de
  lib de geometria (`scripts/zone-cluster.js`) - inclui o caso de zona com "buraco"
  (`test_files/test-zone-with-hole.yaml`).
- Camada interativa no canvas (`HexChronicleLayer`) com 5 ferramentas: Editar,
  Revelar/Ocultar Terreno, Revelar/Ocultar Estrutura, Abrir Link, Importar Arquivos.
- Editor de hexágono em ApplicationV2 (terreno, terreno misto, ícone, label,
  estradas, rios, zonas, link).
- Import em lote dos formatos originais `.md` (frontmatter) e `.yaml`/`.yml`,
  com `js-yaml` vendorizado.
- Fog-of-war em duas camadas: exploração de terreno e revelação de estrutura,
  independentes uma da outra - um hexágono pode ter o terreno conhecido sem que
  a estrutura (ícone/label/link) já tenha sido descoberta. Sigilo é "suave"
  (client-side), compartilhado por todo o grupo. Revelação manual (ferramentas
  dedicadas) e automática (movimento de token, com raio configurável).
- Vínculo de hexágono com Journal Entry/página/Scene ("Open Link"), com
  arrastar-e-soltar da sidebar, respeitando as permissões normais do Foundry.
- Workflow de release no GitHub Actions: tag `vX.Y.Z` empacota o módulo e
  carimba `version`/`manifest`/`download` automaticamente.

### Bugs encontrados e corrigidos via teste ao vivo (Foundry v13)
- ApplicationV2 exige que cada "part" do template renderize um único elemento
  raiz - o formulário do editor tinha vários irmãos soltos e quebrava ao abrir.
- Um `InteractionLayer` puro (diferente de `PlaceablesLayer`) nunca ativava a
  camada sozinho ao trocar de controle na barra de ferramentas - corrigido com
  um hook em `renderSceneControls`.
- `ui.controls.activeTool` está deprecated (removido na v16) - trocado por
  `ui.controls.tool.name`.
- Uma textura de ícone ausente/malformada podia derrubar a renderização do
  mapa inteiro (`new PIXI.Sprite` quebrando) - agora a textura é validada
  antes de virar sprite, com fallback pro label em vez de crash.
- Cena sem nenhum hexágono cadastrado não desenhava nada, nem uma grade vazia
  pra clicar - agora desenha uma grade inicial de 3 anéis, centralizada no
  centro da cena (não em (0,0) do mundo, que fica longe da câmera padrão).
- A camada ficava permanentemente interativa (`eventMode` nunca desligava),
  então qualquer clique com qualquer ferramenta de qualquer grupo mexia no
  hexágono - corrigido com `_activate()`/`_deactivate()` ligando/desligando a
  interatividade conforme o controle selecionado, mais uma checagem explícita
  `tool === "edit"` no lugar de um fallback genérico.
- O dropdown de "Terreno" usava `{{selectOptions}}` com um array simples, e o
  Foundry usa o **índice do array** como valor salvo nesse caso - escolher
  "heavy_woods" salvava `"2"`. Corrigido passando um objeto chave→valor.

### Rodada de testes ao vivo GM + Player (mundo "HUMV Teste")
Sessão dupla (Gamemaster e TesterPlayer conectados ao mesmo tempo) cobrindo
o ciclo completo de edição, fog-of-war e permissões. Nenhum bug encontrado
desta vez - todos os pontos abaixo se comportaram exatamente como
documentado no código:
- Editor de hexágono: abrir um hex já preenchido carrega corretamente tipo
  de terreno, terreno misto (`hills: N`), estradas/rios e zona; salvar um
  hex novo grava exatamente o que foi digitado e fecha o formulário.
- Fog de terreno: hex não explorado retorna `terrain.type: "unknown"` e
  esconde todo o resto (alt, ícone, link, etc.) para um não-GM.
- Fog de estrutura: mesmo com o hex explorado, um `icon` só aparece pro
  jogador depois de "Reveal/Hide Structure" - `alt` (label) e `link`
  ficam escondidos junto até lá.
- "Open Link": um link autorado num hex não-explorado não vaza (jogador
  recebe "sem link", não um link quebrado); uma vez explorado, o link
  aparece e abre a ficha respeitando a permissão real do documento no
  Foundry (sem permissão → ficha abre vazia; com Observer → conteúdo
  completo).
- Confirmado que a ferramenta "edit" fica visível pro jogador (rotulada
  "Ver Hexágono" em vez de "Editar Hexágono") mas clicar não faz nada -
  bate com a limitação já registrada abaixo.
- Achado à parte (não é bug do módulo, é do meu método de limpeza de
  teste): `Scene#setFlag` faz merge profundo, então reatribuir o objeto
  inteiro de `hexes` sem uma chave não a remove - é preciso
  `Scene#unsetFlag(MODULE_ID, "hexes.<key>")` pra apagar de fato.

### Segunda rodada: import em lote, zonas, grade inicial, auto-revelação
Testado em cenas descartáveis próprias (criadas e apagadas depois, sem
tocar na cena compartilhada). Também sem bugs novos:
- **Import em lote**: os `.md`/`.yaml`/`.yml` de `test_files/` importaram
  certo, inclusive coordenadas negativas (`-01-01-isle.md` → hex `-1,-1`,
  chaves YAML `"-02-01"`/`"00-01"`), os aliases em francês "NO"/"SO"
  normalizados pra "NW"/"SW", e um arquivo `.txt` inválido no meio do lote
  gerou erro isolado sem abortar o resto da importação.
- **Zona com buraco** (`test-zone-with-hole.yaml`): `zoneClusterLoops()`
  devolveu exatamente 2 loops pro cluster de 6 hexes em anel - o contorno
  externo (19 pontos) e o contorno interno do buraco (7 pontos, do hex que
  fica de fora da zona) - confirmando o caso descrito no comentário do
  arquivo.
- **Ícone quebrado não derruba o mapa**: importar hexes com `icon` de
  nomes que não existem nos assets do módulo (ex.: `ruines`, `capitale`)
  gerou 404 + `console.warn` (`icon not found: ...`), mas o resto da cena
  renderizou normalmente - confirma a proteção contra crash já registrada
  acima.
- **Grade inicial em cena vazia**: cena nova sem nenhum hex gravado
  desenhou exatamente 37 células (anel de raio 3), centradas no hex mais
  próximo do centro real da cena (`scene.width/2, scene.height/2`), não em
  `(0,0)`.
- **Auto-revelação por movimento de token**: mover um token com dono
  jogador pra dentro de um hex não-explorado revela esse hex
  automaticamente; com a configuração "Auto Reveal" desligada, o mesmo
  movimento não revela nada. `resetFog()` também testado isoladamente e
  limpa o flag `explored` inteiro corretamente.

### Visual
- Paleta de terreno trocada de cores "clipart" saturadas por tons mais
  naturais/suaves (mesmo mapeamento semântico).
- Grade mais fina e translúcida, números de coordenada menores e discretos.
- Formulário do editor reorganizado em seções (`fieldset`) com ícones:
  Terreno, Estrutura, Estradas & Rios, Zonas & Links.
- **Editor visual de terreno misto/estradas/rios** (`scripts/hex-diagram.js`):
  as duas caixas de texto (`lake: C`, `SW SE`) viraram um mini-diagrama SVG
  clicável do hexágono, construído com a mesma geometria pura que o canvas
  usa (`zonePolygon`/`pathPoints` de `geometry.js`), então o resultado é
  visualmente idêntico ao mapa real - inclusive a paleta de cores, puxada de
  `render.js#palette()` (já respeita `paletteOverride`).
  - **Terreno misto**: 7 zonas clicáveis (N/NE/SE/S/SW/NW/C); escolhe um
    "pincel" de terreno na paleta de amostras e clica pra pintar, clica de
    novo com o mesmo pincel pra limpar. Zonas sem override mostram um tom
    fraco da cor do terreno-base (atualiza ao vivo se o `<select>` de
    terreno mudar).
  - **Estradas/Rios**: clica em dois pontos cardeais em sequência pra
    desenhar um caminho entre eles (curva através do centro, igual ao
    render real); clica num caminho já desenhado pra removê-lo. Um alternador
    troca entre editar estradas e rios no mesmo diagrama.
  - O textarea original continua existindo dentro de um `<details>`
    recolhido ("Edit as text") como via de escape para dados legados/edição
    manual - editar o texto ali re-sincroniza o diagrama ao vivo, e vice-versa.
  - Nada mudou no formato salvo: o diagrama só escreve no mesmo textarea que
    o `#onSubmit` já lia, então `normalizeHexContent`/storage ficaram
    intocados. Testado ao vivo como GM: carregamento de hex existente
    (`hills: N` pré-pintado certo), pintar/apagar/toggle, sincronia
    bidirecional com o texto bruto, desenhar+remover estrada e rio
    independentemente, e um submit completo salvando exatamente o que o
    diagrama montou.
- **Janela do editor rolável**: os diagramas acima deixaram o formulário
  mais alto que a tela em muitos casos, e `.window-content` não tinha
  scroll - confirmado ao vivo que o botão Save ficava literalmente
  inalcançável (`overflow-y: hidden`, conteúdo de ~1300px numa janela de
  ~680px). Corrigido com `overflow-y: auto` + `window.resizable: true`
  em `scripts/hex-editor.js`/`styles/hex-chronicle.css`. Nota: `scrollable`
  nas `PARTS` do ApplicationV2 só guarda/restaura a posição do scroll entre
  re-renders - não ativa `overflow-y` sozinho, isso ainda precisa de CSS.
- **Destaque do hexágono sob o cursor** (`scripts/layer.js`): passar o mouse
  sobre a cena, com qualquer ferramenta do grupo Hex Chronicle ativa, desenha
  um contorno translúcido no hexágono embaixo do cursor - útil pra saber o
  que um clique vai atingir antes de clicar, principalmente pra ferramentas
  que não têm feedback visual próprio (Reveal, Reveal Structure, Open Link).
  Puramente geométrico (`pointToHex`/`hexShapePoints`, mesmas funções que o
  clique já usava) - sem gate de permissão, funciona igual pra GM e jogador.
  Desenhado num `PIXI.Graphics` irmão do `container` (não filho), então
  `refresh()` reconstruindo o conteúdo nunca apaga o destaque atual; limpo
  em `pointerout` e em `_deactivate()` pra não deixar um contorno "fantasma"
  ao trocar de ferramenta. Testado ao vivo como GM e como jogador: desenha
  ao entrar num hex, não redesenha à toa dentro do mesmo hex, some ao sair
  do grid e ao desativar a camada, e sobrevive a um `refresh()`.

## Em aberto / próximos passos

Nenhum destes tem prazo definido - são ideias discutidas, priorizadas
aproximadamente por esforço/impacto.

### Ganhos rápidos
- **Botão de resetar fog** exposto na interface - a função `resetFog()` já
  existe em `fog.js` mas não está ligada a nenhum botão/ferramenta ainda.
- **Seletor visual de ícone** com preview (em vez de digitar o nome do arquivo
  de cor).

### Para mapas grandes
- **Buscar/ir para hexágono por coordenada.**
- **Legenda de terreno/zona** visível na tela.

### Para overlay em arte customizada
- **Alça de arrastar** pra reposicionar/escalar a grade visualmente sobre uma
  imagem de fundo, em vez de digitar offset/raio nas configurações.

## Limitações conhecidas (decisões deliberadas, não bugs)

- **Sigilo é "suave", não real**: o conteúdo de hexágonos não explorados
  continua presente no client de qualquer jogador com acesso à cena (é assim
  que flags do Foundry funcionam). Um jogador que abrir o console do
  navegador consegue ler os dados brutos. Sigilo "forte" (autoritativo via
  socket do GM) ficaria para uma versão futura, se for realmente necessário.
- **Revelação automática depende do client do GM estar conectado** - é ele
  quem escreve a flag de exploração.
- **A ferramenta "Ver Hexágono" (não-GM) ainda não faz nada** - clicar não
  abre nenhuma visualização somente-leitura. Pendente desde o início do
  port, baixa prioridade.
- Zonas (fronteiras tracejadas) só aparecem pro GM - podem revelar a forma de
  uma área secreta antes da hora, e não há um "desconhecido" equivalente pra
  esconder isso de jogadores.
