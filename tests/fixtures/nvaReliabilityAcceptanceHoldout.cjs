// Separate acceptance corpus, authored after the October 24 safety corrections.
// Never used to tune the classifier; synthetic messages, no customer data.
const groups={
 GREETING:`Bonjour depuis le quartier de Limete
Hello chers membres du bureau
Bonsoir, content de trouver votre contact
Salut, c'est ma première visite ici
Coucou NVA, belle matinée à vous
Bonjour de notre part à tous
Bon après-midi depuis Matadi
Bonsoir, comment allez-vous aujourd'hui`,
 MAIN_MENU:`Je voudrais revoir le menu proposé au départ
L'accueil principal est où dans ce chat ?
Affichez à nouveau vos choix principaux
J'ai perdu votre menu, remettez-le svp
On reprend à l'accueil de l'assistant
Présentez le menu pour orienter ma demande
Réouvrez les choix principaux disponibles
Pouvez-vous revenir au menu de présentation ?`,
 TRAINING_INFORMATION:`Un renseignement général sur votre institution svp
Je cherche des informations pour mon orientation
Que contient votre offre de formation publique ?
Expliquez les caractéristiques principales de la formation
Une information sur votre centre me serait utile
Je viens simplement chercher des renseignements
Votre formation s'adresse à quel public ?
Quelqu'un peut présenter les informations essentielles ?`,
 TRAINING_LIST:`Quelles formations peut envisager un salarié ?
Je cherche vos programmes pour l'année suivante
Faites-moi découvrir le catalogue des apprentissages
Quels cours proposez-vous aux nouveaux candidats ?
Je voudrais voir toutes les formations de NVA
Vous pouvez énumérer vos différentes formations ?
La liste des formations est disponible où ?
Quels programmes sont au catalogue aujourd'hui ?`,
 ENGLISH_TRAINING:`Je veux me perfectionner en anglais avec NVA
L'anglais est mon principal besoin professionnel
Vous aidez ceux qui ont oublié leur anglais ?
Je souhaiterais renforcer mon anglais écrit
English is my preferred subject
Mon fils adulte cherche à apprendre l'anglais
L'anglais pour voyager me serait utile
J'ai un intérêt particulier pour votre anglais`,
 PRICING:`Quel tarif est prévu pour une personne seule ?
Le prix concerne un niveau ou tout le programme ?
Je voudrais connaître le coût publié actuellement
Combien coûte la formation si je prends tout ?
Donnez le budget du niveau pour un salarié
Quels montants figurent dans votre grille de tarifs ?
Le coût total est-il annoncé avant le départ ?
Votre prix est de combien pour le parcours ?`,
 PAYMENT_TERMS:`Comment payer le reste une fois les essais finis ?
Je peux verser un acompte pour poursuivre ?
Vous acceptez un règlement en plusieurs versements ?
À quel stade faut-il régler le solde du niveau ?
Je voudrais payer la moitié du niveau d'abord
Le paiement intégral est obligatoire avant la fin ?
Le reste du paiement peut attendre la fin du niveau ?
Quelle échéance appliquez-vous au montant restant ?`,
 FREE_TRIAL:`Les séances gratuites sont comprises dans le programme total ?
Je peux bénéficier d'un essai sans engagement immédiat ?
Les cinq séances offertes concernent quels nouveaux élèves ?
Je voudrais essayer votre programme avant une décision
Combien de cours gratuits sont inclus au départ ?
Les cours offerts me permettraient de tester le niveau
Vous permettez de tester avant de sortir d'argent ?
La période d'essai gratuite se trouve dans le niveau initial ?`,
 TRAINING_DURATION:`Quel est le nombre d'heures prévu par niveau ?
Combien de séances représentent les trois niveaux réunis ?
Je voudrais savoir combien de temps dure chaque niveau
Votre parcours contient seize séances dans chaque niveau ?
Combien de niveaux faut-il finir avant la fin du parcours ?
Une rencontre dure une heure et demie, c'est bien cela ?
La durée totale du parcours serait de combien ?
Combien de minutes consacre-t-on à chaque rencontre ?`,
 TRAINING_SCHEDULE:`Quels horaires sont prévus pour les participants du soir ?
Consultez les créneaux accessibles le samedi
Quel est votre emploi du temps pour les salariés ?
Je voudrais le planning détaillé des cours
Quels jours correspondent aux cours du week-end ?
Je cherche un horaire du matin dans vos groupes
Les créneaux de fin de journée existent-ils ?
Vous pouvez m'indiquer vos horaires actuels ?`,
 SESSION_START_DATE:`À quelle date démarre la cohorte suivante ?
Vous pouvez préciser le début du prochain niveau ?
Le groupe suivant commence dans quel mois ?
Je voudrais la date de rentrée déjà annoncée
Quand aura lieu le premier cours du nouveau groupe ?
La date du démarrage est-elle confirmée dans NVA ?
À quel jour correspond votre première séance ?
Le nouveau cycle débute à quel moment exactement ?`,
 AVAILABLE_SESSIONS:`Quelles sessions ont encore des places pour nous ?
Vous avez un groupe encore ouvert aux candidats ?
Le nombre de places disponibles est connu ?
Je recherche une session ouverte pour un adulte
Quels groupes ne sont pas encore complets ?
Une session disponible accepte-t-elle des débutants ?
Vous savez quelles sessions acceptent de nouveaux élèves ?
Il reste des places disponibles dans les nouveaux groupes ?`,
 CERTIFICATION:`Ce certificat porte le nom de votre académie ?
Le diplôme est-il soumis à des conditions administratives ?
Un certificat est-il prévu seulement à la fin complète ?
Qui atteste officiellement la certification de NVA ?
Le certificat permet-il de prouver le parcours terminé ?
Existe-t-il une preuve d'accréditation de ce diplôme ?
Votre certificat bénéficie-t-il d'une reconnaissance internationale établie ?
Les conditions de certification sont définies par qui ?`,
 CERTIFICATE_COST:`Le certificat fait l'objet de quels frais supplémentaires ?
Quel est le montant des frais de votre certificat ?
L'attestation a un tarif séparé de la formation ?
Le coût de délivrance du certificat est annoncé où ?
Je voudrais réserver le budget pour l'attestation
Il faut un paiement distinct pour obtenir le certificat ?
Quel prix s'applique au document de certification ?
Le certificat occasionne un supplément de combien ?`,
 ONLINE_LEARNING:`Tous les cours se déroulent en ligne sur internet ?
On peut suivre à distance en restant chez soi ?
Je dois me rendre dans les locaux chaque semaine ?
Votre académie assure aussi un enseignement en présentiel ?
Il faut être physiquement dans le centre pour participer ?
Je suis dans une autre ville et voudrais participer
L'apprentissage en ligne est-il votre seul format ?
Puis-je me connecter à distance depuis une province ?`,
 TEACHING_METHOD:`Votre méthode comporte-t-elle des échanges entre élèves ?
Quelle pédagogie appliquez-vous à un public adulte ?
Le professeur donne des exercices à réaliser ?
L'enseignant nous accompagne pendant les activités ?
Vous faites pratiquer la conversation en séance ?
Les activités se déroulent individuellement ou en petits groupes ?
Comment vos cours font-ils travailler la pratique orale ?
Votre méthode convient à quelqu'un de timide ?`,
 REGISTRATION:`Je viens pour effectuer une inscription personnelle
Je souhaite rejoindre NVA dès que possible
Comment devenir étudiant dans cette académie ?
Les démarches d'inscription se font avec qui ?
Je voudrais m'inscrire après ma réflexion
Aidez-moi à lancer la demande d'inscription
Je suis prêt pour commencer une inscription
On peut s'occuper de mon inscription maintenant ?`,
 REGISTRATION_WEBSITE:`Je préfère passer via le site pour mes coordonnées
Je choisis votre site comme mode d'inscription
Je vais m'inscrire par le site de l'académie
Mon inscription sera remplie sur votre site
Le site est mon choix pour le formulaire
Je souhaite utiliser votre site pour m'inscrire
Je vais procéder via votre site pour la demande
Je préfère le formulaire de votre site officiel`,
 REGISTRATION_WHATSAPP:`Je vais m'inscrire ici via votre WhatsApp
Je préfère l'aide sur WhatsApp pour mon formulaire
WhatsApp sera ma méthode pour m'inscrire
Je choisis de passer par votre assistance WhatsApp
Je veux m'inscrire sur WhatsApp avec un accompagnement
Mon choix d'inscription est votre WhatsApp
Je préfère utiliser WhatsApp pour saisir mes informations
Via WhatsApp je pourrai faire mon inscription`,
 REGISTRATION_STATUS:`Ma demande d'inscription en attente a-t-elle progressé ?
Je viens connaître le statut de ma demande en cours
Où en est la demande que je vous ai envoyée ?
Le suivi de l'inscription me concerne aujourd'hui
Qui consulte le statut de mon dossier d'inscription ?
Ma demande est-elle toujours en attente dans votre système ?
J'attends des nouvelles du statut de mon inscription
Je cherche le suivi de la demande transmise`,
 HUMAN_ADVISOR:`Je demande un conseiller d'admission pour mon dossier
Une responsable peut-elle intervenir dans ce chat ?
J'aimerais parler à quelqu'un de votre bureau
Un humain pourrait-il m'accompagner personnellement ?
Je veux une intervention administrative pour corriger mon compte
Je souhaite discuter avec une personne de votre équipe
Le paiement a un problème à résoudre par votre bureau
J'ai besoin de joindre un agent de l'académie`,
 THANKS:`Merci de m'avoir donné tous ces éléments
Je vous remercie, les réponses m'ont été utiles
Un chaleureux merci à vos collaborateurs
Merci pour ce temps passé à m'expliquer
Je remercie toute l'académie pour son accueil
Votre explication suffit, merci beaucoup à vous
Merci sincèrement pour cet échange
Je vous dis merci pour votre disponibilité`,
 GOODBYE:`Je vous souhaite une bonne soirée à tous
Au revoir, je vais en discuter avec ma famille
À bientôt lorsque je serai disponible
Je vous laisse pour aujourd'hui, à demain
Passez une excellente journée au bureau
À très bientôt pour une prochaine discussion
Bonne journée et au revoir à votre équipe
Au revoir de ma part, merci pour l'échange`,
 UNKNOWN:`Peux-tu calculer la racine carrée de cent ?
Je voudrais un conte de fées pour ce soir
Où acheter un bon vélo de randonnée ?
Fais une liste de légumes pour mon repas
Qui a remporté le tournoi de tennis hier ?
Peux-tu dessiner un arbre de Noël ?
Quelle chanson écouter pendant mon voyage ?
Réserve une table de restaurant pour ma famille`,
 REFUSAL:`Je décline votre offre pour cette année
Nous déclinons votre proposition pour le moment
Je rejette cette proposition aujourd'hui
Non merci je préfère réfléchir tranquillement
Je ne veux pas m'inscrire cette semaine
Cela ne m'intéresse pas à présent, merci
Je préfère attendre avant de décider
Je ne choisis pas la seconde possibilité finalement`,
};
const result=Object.entries(groups).flatMap(([intent,lines])=>lines.split('\n').map(text=>({text,intents:[intent],...(intent==='REFUSAL'?{critical:true}:{})})));
const contexts=[
 ['La deuxième méthode pour mon cas',['REGISTRATION_WHATSAPP']],
 ['Le premier choix finalement pour moi',['REGISTRATION_WEBSITE']],
 ['Je préfère la seconde des deux possibilités',['REGISTRATION_WHATSAPP']],
 ['Prenons le choix numéro un cette fois',['REGISTRATION_WEBSITE']],
 ['Je veux WhatsApp sans utiliser le site pour mes coordonnées',['REGISTRATION_WHATSAPP']],
 ['Le site plutôt, pas WhatsApp pour cette demande',['REGISTRATION_WEBSITE']],
 ['Via le site ou bien via WhatsApp, je ne sais pas',['UNKNOWN']],
 ['Je ne choisis pas le site mais je préfère WhatsApp pour mon formulaire',['REGISTRATION_WHATSAPP']],
];
const multi=[
 ['Expliquez la durée puis les horaires publiés',['TRAINING_DURATION','TRAINING_SCHEDULE']],
 ['Je veux le prix du niveau et une inscription avec vous',['PRICING','REGISTRATION']],
 ['Le tarif et le début de la session sont annoncés ?',['PRICING','SESSION_START_DATE']],
 ['Le certificat et les frais du cours sont mes deux questions',['CERTIFICATE_COST','PRICING']],
 ['Les cours sont en ligne et quels créneaux peut-on choisir ?',['ONLINE_LEARNING','TRAINING_SCHEDULE']],
 ['Quel est le prix du certificat et quand commence le groupe ?',['CERTIFICATE_COST','SESSION_START_DATE']],
 ['Je peux payer en plusieurs fois et profiter des séances gratuites ?',['PAYMENT_TERMS','FREE_TRIAL']],
 ['Les sessions ouvertes démarrent quand exactement ?',['AVAILABLE_SESSIONS','SESSION_START_DATE']],
];
module.exports=[...result,...contexts.map(([text,intents])=>({text,intents,context:{registrationMethod:true},critical:true})),...multi.map(([text,intents])=>({text,intents}))];
