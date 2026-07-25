---
slug: le-t-ou-parfois-ecrit-t-veut-dire-transposee
title: "Le ⊤ (ou parfois écrit T) veut dire transposée"
author: ""
date: "2026-07-25"
source_type: personal-notes
origin: interne
topics: [machine-learning, mathematiques]
entities: [transposee]
url: ""
source_file: "note-9.txt"
---

> [[../by-date/2026/2026-07/2026-07|2026-07]] · Thèmes : [[../themes/machine-learning|Machine Learning]], [[../themes/mathematiques|Mathematiques]]

> · [[../by-date/2026/2026-07/2026-07-25|2026-07-25]] · Thèmes : [[../themes/machine-learning|Machine Learning]], [[../themes/mathematiques|Mathématiques]]

## Le ⊤ (ou parfois écrit T) veut dire transposée
`topics: [mathematiques, machine-learning]` `entities: [transposee]`

C'est une opération sur les matrices.

## Ce que ça fait
`topics: [mathematiques]` `entities: [transposee]`

Transposer une matrice, c'est échanger ses lignes et ses colonnes. Ce qui était en ligne devient colonne, et inversement.

Exemple avec un vecteur. Un vecteur colonne devient un vecteur ligne :

𝑦
=
[
𝑦
1


𝑦
2


𝑦
3
]
⟹
𝑦
⊤
=
[
𝑦
1
	
𝑦
2
	
𝑦
3
]
y=
	​

y
1
	​

y
2
	​

y
3
	​

	​

	​

⟹y
⊤
=[
y
1
	​

	​

y
2
	​

	​

y
3
	​

	​

]

Exemple avec une matrice. L'élément qui était à la position (ligne 
𝑖
i, colonne 
𝑗
j) se retrouve à la position (ligne 
𝑗
j, colonne 
𝑖
i) :

𝑋
=
[
𝑥
1
	
1


𝑥
2
	
1


𝑥
3
	
1
]
⟹
𝑋
⊤
=
[
𝑥
1
	
𝑥
2
	
𝑥
3


1
	
1
	
1
]
X=
	​

x
1
	​

x
2
	​

x
3
	​

	​

1
1
1
	​

	​

⟹X
⊤
=[
x
1
	​

1
	​

x
2
	​

1
	​

x
3
	​

1
	​

]

La matrice 
𝑋
X était de taille 
3
×
2
3×2 (3 lignes, 2 colonnes) ; sa transposée 
𝑋
⊤
X
⊤
 est de taille 
2
×
3
2×3. Les dimensions s'inversent aussi.
