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
- **Ícone quebrado não derruba o mapa**: importar um hex com `icon`
  apontando pra um nome inexistente gerou 404 + `console.warn`
  (`icon not found: ...`), mas o resto da cena renderizou normalmente -
  confirma a proteção contra crash já registrada acima. (Nota: os nomes
  citados numa versão anterior desta entrada - `ruines`, `capitale` - na
  verdade existem em `assets/icons/building/`; foi outro nome inventado no
  teste que gerou o 404, não esses.)
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
- **Botão de resetar fog**: a função `resetFog()` já existia em `fog.js` mas
  não estava ligada a nada - agora é um botão (`fa-broom`) no grupo Hex
  Chronicle, GM-only, atrás de um `DialogV2.confirm()` já que é destrutivo e
  irreversível (limpa a exploração de TODOS os jogadores na cena de uma vez).
  `confirmResetFog()` em `fog.js` cuida do dialog + reset + refresh da
  camada. Testado ao vivo como GM: botão só aparece pro GM, cancelar não
  mexe em nada, confirmar zera o flag `explored` inteiro e dispara a
  notificação de sucesso.
- **Seletor visual de ícone** (`scripts/hex-icon-picker.js`): o campo
  "Building icon" ganhou uma grade com preview real dos 14 ícones que o
  módulo já traz em `assets/icons/building/` (mais um botão "Nenhum"), em
  vez de precisar digitar o nome do arquivo de cor. O campo de texto
  continua visível e editável do lado - útil pra um ícone customizado que
  não esteja na lista - com sincronia nos dois sentidos (clicar atualiza o
  texto, digitar atualiza qual ícone aparece selecionado; clicar de novo no
  já selecionado limpa). Mesmo padrão dos outros widgets: só escreve no
  `<input name="icon">` que já existia, então nada mudou na submissão nem
  no storage. Testado ao vivo como GM: as 14 imagens carregam sem 404,
  clique/toggle/digitação sincronizam certo, e um submit completo salva o
  ícone escolhido.
- **Diretório de hexágonos** (`scripts/hex-directory.js` +
  `templates/hex-directory.hbs`): janela GM-only nova (botão `fa-table-list`
  no grupo Hex Chronicle) que lista todo hexágono já autorado na cena atual
  - coordenada, terreno (+ mistura + zonas), label/ícone/link - com busca
  por texto livre (filtra por qualquer um desses campos) e dois botões por
  linha: "ir até" (centraliza a câmera no hex via `canvas.animatePan` +
  acende um flash amarelo nele, `HexChronicleLayer#flashHex()` - novo,
  funciona mesmo com a camada Hex Chronicle desativada) e "editar" (abre o
  `HexEditor` daquele hex direto). Lê o conteúdo *cru*, sem gate de fog -
  é GM-only, então não tem nada a esconder do próprio GM. "Dinâmico": a
  lista se auto-atualiza sozinha ao editar qualquer hex (hook `updateScene`)
  e ao trocar de cena (hook `canvasReady`) enquanto a janela fica aberta -
  sem botão de refresh manual. É singleton (clicar de novo no botão só foca
  a janela já aberta, não duplica) e desregistra os hooks no `close()`.
  Testado ao vivo como GM: lista carrega e ordena certo, busca filtra e
  mostra "sem resultados" corretamente, "ir até" chama `animatePan` com as
  coordenadas certas e acende o flash, "editar" abre o hex certo, salvar
  uma edição reflete na lista sem eu chamar nada manualmente, fechar a
  janela realmente para de escutar (editar depois não reabre nem erra), e
  o botão não aparece pra um jogador não-GM.
- **Legenda de terreno/zona na tela** (`scripts/hex-legend.js`): novo botão
  liga/desliga (`fa-swatchbook`) no grupo Hex Chronicle, visível pra todo
  mundo. Mostra só o que a cena atual realmente usa - não a paleta inteira
  do módulo - com as mesmas cores de `render.js#palette()`. Zonas só
  aparecem pro GM (mesma regra do mapa: contorno de zona nunca é desenhado
  pra não-GM, exceto quando o GM ativa o toggle por cena que permite
  mostrá-las pra jogadores também). Não é uma janela ApplicationV2, é um painel HTML simples
  fixado num canto (`position:fixed`, canto inferior esquerdo, entre a
  barra de ferramentas e a hotbar - único espaço livre no layout padrão do
  v13). Também "dinâmico": reconstrói sozinho em `updateScene`/`canvasReady`
  enquanto estiver visível. Achado ao testar ao vivo: um único clique no
  botão dispara `onChange` 2-3 vezes seguidas com o mesmo valor de `active`
  (some quirk do scene-controls/Carolingian UI, não é nada que este módulo
  controle) - `showLegend()`/`hideLegend()` precisaram ser idempotentes por
  causa disso. Testado como GM e jogador: jogador só vê a seção de terreno,
  GM vê terreno+zonas, o estado liga/desliga sobrevive a trocar de grupo de
  ferramentas e voltar, e o toggle funciona nos dois sentidos via clique
  real no botão.
- **Alça de arrastar pra alinhar a grade** (`scripts/layer.js`,
  `scripts/settings.js`): última ferramenta GM-only do grupo (`fa-crosshairs`,
  "Align Grid"). Em vez de digitar `originX`/`originY`/`hexRadius` nas
  configurações do mundo às cegas, agora dá pra arrastar dois pontos direto
  no canvas - o vermelho move a origem da grade, o azul (posicionado a
  `origin.x + radius`) redimensiona - com uma grade de pré-visualização (5
  anéis ao redor do hex 0,0) se movendo em tempo real por cima da arte de
  fundo da cena, então o alinhamento fica visual em vez de tentativa-e-erro
  numérico. O preview roda todo em memória (`#dragOrigin`/`#dragRadius`
  locais); só grava nas configurações do mundo (`setOrigin`/`setRadius`,
  novos em `settings.js`) uma vez, ao soltar o botão - nunca a cada frame de
  `pointermove`, pra não martelar o documento de configurações (que é
  world-scope, replicado por socket) a cada pixel de arraste.
  Achado ao testar ao vivo, o mais complicado desta rodada: não existe hook
  do Foundry pra "a ferramenta selecionada dentro do MESMO grupo já ativo
  mudou" - `renderSceneControls` só dispara numa troca de *grupo* (ex.:
  Tokens → Hex Chronicle), confirmado lendo o próprio `foundry.mjs`
  (`SceneControls#onChangeTool` faz um `update()` "leve" pra trocas de
  ferramenta dentro do grupo, sem re-render completo). Sem esse hook, as
  alças só apareciam se algo mais forçasse `updateAlignHandles()` depois -
  meio inútil. Resolvido observando `aria-pressed` nos próprios botões de
  ferramenta via `MutationObserver` (init.js) - único sinal confiável de
  qual ferramenta está selecionada dentro do grupo, encontrado batendo o
  bug ao vivo e não por documentação. Testado ao vivo como GM: as alças
  aparecem sozinhas ao entrar em "align" e somem ao trocar de ferramenta
  (sem chamar nada manualmente), arrastar a origem/raio atualiza o preview
  e grava exatamente o valor certo ao soltar, o raio tem piso de 10px, e um
  "pointerup" real durante o arraste confirma e não abre o editor de hex
  por engano (o clique normal fica suprimido enquanto há um arraste em
  andamento). Botão ausente pra jogador não-GM.

### Subdivisão fina de zonas de terreno (7 → 24 + 13 âncoras)
Pedido do usuário: mais nuance espacial dentro de um hexágono. As 7 zonas
originais (`N`/`NE`/`SE`/`S`/`SW`/`NW`/`C`) viraram **24 zonas finas**
numeradas - `N1..N12` (anel externo, cada uma metade do tamanho dos antigos
trapézios) e `C1..C12` (o antigo hexágono `C` único, agora dividido nos
mesmos 12 cortes angulares que o anel externo usa, então uma peça `N{k}` e
sua correspondente `C{k}` ficam perfeitamente coladas, sem vão nem
sobreposição - confirmado por inspeção direta das coordenadas). Estradas/rios
também dobraram: de 6+`C` pra **12+`C`** pontos de ancoragem (`N1..N12` +
`C`), usando as mesmas 12 posições angulares.

- **Geometria** (`scripts/geometry.js`): os 12 pontos de cada anel
  intercalam o que já existia em dois lugares diferentes do código - os 6
  pontos médios de aresta (`N`/`NE`/`SE`/`S`/`SW`/`NW`, antigo `pathPoints`)
  e os 6 vértices do hexágono (`E`/`NE`/`NW`/`W`/`SW`/`SE`, `outerPoints`) -
  intercalados a cada 30° em vez de usados separadamente. `zonePolygon()`
  agora calcula os quadriláteros `N{k}` e os triângulos `C{k}` a partir
  dessa única função `ringPoints()` (privada; `fineRingPoints()` é a versão
  pública nomeada, usada tanto pelo render quanto pelo diagrama visual).
- **Compatibilidade total, sem migração**: os 7 tokens antigos continuam
  válidos pra sempre - `normalizeSides()`/`normalizePath()`
  (`data-model.js`) expandem cada um pro(s) token(s) fino(s) equivalente(s)
  toda vez que o dado é lido (`N` → `{N12,N1}`, `C` → todos os 12 `C{k}`,
  pontos de estrada `NW` → `N11`, etc.) - já que essa expansão acontece
  dentro de `normalizeHexContent()`, que já era chamada em todo lugar que
  lê um hex, hexágonos salvos antes dessa mudança continuam renderizando
  idêntico sem precisar resalvar nada. Uma vez resalvo (pelo editor ou
  import), o hex passa a guardar os tokens finos.
- **Achado ao testar ao vivo**: `render.js` montava os pontos de
  estrada/rio com o antigo `pathPoints()` (só 7 chaves) - se eu só tivesse
  trocado a validação sem atualizar esse `pp[a]`/`pp[b]`, toda estrada/rio
  salva com token fino teria simplesmente sumido do mapa (`if (!pp[a] ||
  !pp[b]) continue`, uma falha silenciosa). Corrigido trocando pro mesmo
  `fineRingPoints()` que o diagrama usa - inclusive o marcador de link, que
  usava `pp.SE` (agora `pp.N5`, o mesmo canto).
- Testado ao vivo como GM, num hex real com dado legado (`hills: N`) e um
  hex de teste descartável: o diagrama carrega e pinta certo as 2 peças
  finas correspondentes a um token antigo salvo há sessões atrás, dá pra
  pintar/desenhar com os tokens novos e salvar, um hex antigo com rios em
  letras antigas (`C NW`, `NW N`, ...) continua desenhando na cena sem
  erro nem sumiço, e a matemática das 4 peças ao redor de um mesmo corte
  angular (`N1`/`N12`/`C1`/`C12`) foi conferida ponto a ponto - batem
  exatamente, sem vão.
- **Legenda ganhou um diagrama de referência das zonas** (`scripts/hex-legend.js`):
  como `N1`/`C7` etc. não fazem sentido como uma lista de cor (são posição,
  não categoria), a seção nova "Zone positions" desenha um hexágono estático
  de 24 fatias numeradas (1-12 nos dois anéis, já que o anel entendido pela
  posição radial dispensa repetir o prefixo `N`/`C`) usando a mesma
  `zonePolygon()` do editor - não é interativa, só ajuda a decodificar uma
  referência tipo "tem uma cova em C7" sem precisar abrir o editor completo.
  Diferente da lista de "Zones" (secured/dangerous), essa seção é visível
  pra todo mundo, GM ou jogador - é geometria fixa, não informação da
  campanha. Testado ao vivo como GM e jogador: 24 polígonos com os rótulos
  certos nos dois casos, "Zone positions" aparece pros dois enquanto "Zones"
  continua GM-only.

### Hex Overview (2026-08-23)
Substituição do Hex Directory (lista pesquisável) por Hex Overview
(dashboard). Novas funcionalidades:
- **Agregação de estatísticas**: contagem de terreno, notas, links e ícones
  em todos os hexes da cena num relance.
- **Filtros combináveis**: terreno, zona, notas e link - refinam a tabela em
  tempo real sem recarregar.
- **Edição inline rápida**: clique no rótulo ou nas notas de um hex pra
  editar direto, sem abrir o formulário completo.
- **Zona-tag por prompt rápido**: adicione ou remova uma zona-tag de um hex
  direto na tabela via um `window.prompt()`, sem abrir o editor completo
  (não é edição inline como rótulo/notas, mas evita o formulário completo
  mesmo assim).
- **Toggles por linha**: revelar/ocultar terreno ou estrutura por hex
  individual, ou via seleção múltipla (ver próximo ponto).
- **Ações em lote**: selecione múltiplas linhas, depois revele/oculte terreno
  ou estrutura, ou adicione/remova uma zona-tag, tudo de uma vez - sem abrir
  o editor pra cada hex.
- **Campo de notas GM**: novo campo no editor de hex, visível só pro GM,
  pra anotações privadas (estratégia de campanha, NPCs que moram ali, etc).

### Ampliação da aba de cena + registros de biomas/estruturas customizados - pendente de teste ao vivo
Continuação da aba "Hex Chronicle" na Scene Configuration (ver seção
seguinte): três novos overrides por cena e um subsistema novo de mundo
inteiro.
- **Controle por ferramenta**: cada ferramenta da toolbar (Editar, Revelar
  Terreno, Revelar Estrutura, Abrir Link, Align Grid, Import, Reset Fog,
  Overview, Legend) ganhou seu próprio checkbox de visibilidade por cena
  (`sceneOverrides.tools.<nome>`, `settings.js#isToolVisibleOnScene`).
- **Estilo de linha da grade**: tipo (sólida/tracejada/pontilhada/nenhuma),
  cor, espessura e opacidade, configuráveis por cena
  (`sceneOverrides.gridStyle`, `settings.js#getGridStyle`,
  `render.js#drawGrid` reescrito pra ramificar por tipo, reaproveitando o
  mesmo traço segmentado que os contornos de zona já usavam).
- **Zonas visíveis a jogadores**: toggle independente, não amarrado à
  revelação de estrutura (`sceneOverrides.zonesVisibleToPlayers`,
  `settings.js#isZoneVisibleToPlayers`) - confirmado explicitamente que são
  "duas coisas diferentes" durante o brainstorm desta feature.
- **Biomas e estruturas customizados** (`scripts/custom-registry.js`,
  `scripts/biome-structure-manager.js`): dois world settings `config:false`
  (`customBiomes`, `customStructures`), cada entrada só nome + cor (bioma)
  ou nome + imagem via `FilePicker` (estrutura), slug derivado
  automaticamente do nome. Gerenciados por uma janela própria
  (`BiomeStructureManager`) atrás de um `game.settings.registerMenu` em
  Configure Settings - mundo inteiro, não por cena, já que um bioma/
  estrutura definido vale pra qualquer cena. Integrado em todo lugar que
  antes só conhecia a lista fixa: `data-model.js#getAllTerrainTypes()`
  (dropdown de terreno + pincel de terreno misto), `render.js#palette()`
  (cores), `data-model.js#resolveIcon()`/`render.js#getIconTexture()`
  (resolução do ícone customizado via prefixo `custom:<slug>`, path
  completo do `FilePicker` em vez da convenção `assets/icons/building/`
  do módulo), `hex-icon-picker.js` (grade de ícones). Remover uma entrada
  customizada não migra os hexes que já a referenciam - cai na mesma
  tolerância de "tipo/ícone desconhecido" que um typo já tinha antes.
- **Não testado ao vivo ainda** (mesma limitação já registrada na seção
  seguinte) - ver os itens 19-22 do "Verifying this build" do README antes
  de considerar pronto.

### Configuração por cena (aba "Hex Chronicle" na Scene Configuration) - pendente de teste ao vivo
Todas as configurações do módulo eram world-scope (uma única grade/paleta/
auto-revelação para todas as cenas), apesar de a ferramenta Align Grid já
ser operada cena por cena. Nova aba injetada na ficha nativa de Scene
Configuration do Foundry (`scripts/scene-config.js`, hook `renderSceneConfig`
- não há API declarativa pra plugar aba numa ficha core que o módulo não
possui, então é injeção de DOM: item de navegação + painel, lidos a partir
do `data-group` real de uma aba existente em vez de assumir um nome fixo):
- **Enabled**: liga/desliga o módulo inteiro nessa cena - desligado esconde
  o grupo de ferramentas inteiro na toolbar (GM e jogador) e o `refresh()`
  da camada para de desenhar qualquer coisa (`layer.js`). Ausência da flag
  (toda cena anterior a esta feature) lê como ligado, preservando o
  comportamento anterior.
- **Overrides por cena**: raio/origem da grade, auto-revelação (liga/desliga
  + raio) e paleta de cores, cada um atrás do seu próprio checkbox
  "Override for this scene" - sem isso, `settings.js` cai no valor
  world-scope de sempre. `setOrigin()`/`setRadius()` (usados pela ferramenta
  Align Grid) passaram a gravar no override da cena, e não mais na
  configuração do mundo - corrige a inconsistência de uma ferramenta
  operada por cena escrever um valor global.
- Campos usam `name="flags.hex-chronicle-vtt...."` dentro do `<form>` nativo
  da ficha, então o próprio submit handler do Foundry já persiste via
  `scene.update()` - nenhuma lógica de submit própria foi necessária.
- **Não testado ao vivo ainda** (sem uma instância real de Foundry disponível
  neste ambiente) - a técnica de injeção de aba, o `changeTab()` programático
  e o comportamento de checkbox/`data-dtype="Number"` do `FormDataExtended`
  seguem convenções documentadas e usadas por outros módulos v13, mas
  precisam de confirmação prática: abrir a Scene Configuration, alternar
  entre a aba nova e as abas core (nenhuma sobreposição visual), marcar/
  desmarcar "Enabled" e conferir que a toolbar some/aparece pra GM e
  jogador, marcar cada override e conferir que o valor realmente aplica
  (grade, auto-revelação, paleta) e que desmarcar volta pro valor global.

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
- Zonas (fronteiras tracejadas) só aparecem pro GM por padrão - podem revelar
  a forma de uma área secreta antes da hora, e não há um "desconhecido"
  equivalente pra esconder isso de jogadores. Existe agora um toggle por cena
  ("mostrar contornos de zona pra jogadores") que permite ao GM optar por
  exibi-las mesmo assim quando isso não for um problema.
- **Zonas com hachura por padrão** (`render.js#drawZoneHatch`): trazido de
  uma implementação paralela que havia divergido em `main` e foi reconciliada
  de volta nesta branch. Cada zona pinta um padrão translúcido (diagonal,
  cruzado, horizontal, vertical ou pontilhado) sobre os hexágonos que a
  compõem, clipado ao hexágono individual via um clipper Cyrus-Beck
  (`clipSegmentToConvexPolygon`) - preserva a cor do terreno por baixo em vez
  de escondê-la. O contorno tracejado do cluster continua por cima, mais
  sutil. Os padrões por zona vêm de um mapa fixo do módulo
  (`DEFAULT_ZONE_PATTERNS`), não de um JSON por cena - a versão de `main`
  permitia customizar isso por cena, mas foi descartada por competir
  diretamente com `custom-registry.js`/`biome-structure-manager.js`.
