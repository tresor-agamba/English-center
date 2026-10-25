// Validation-only corpus, authored after implementation and kept out of rule tuning.
// Synthetic prospects; not collected customer conversations.
const groups={
 GREETING:`Bonjour à toute l'équipe de NVA
Salut, je viens de découvrir votre centre
Bonsoir madame ou monsieur
Hello, il y a quelqu'un ici ?
Bonjour chers responsables
Salut à vous tous
Bon après-midi NVA
Bonjour, j'espère que vous allez bien`,
 MAIN_MENU:`Revenir au menu principal
Je voudrais retourner à l'accueil
Affichez le menu principal
On peut recommencer depuis le menu ?
Ramenez-moi à l'accueil
Montrez les choix principaux
Je veux revoir le menu de départ
Retour au menu principal s'il vous plaît`,
 TRAINING_INFORMATION:`Présentez votre centre de formation
J'aimerais des informations sur votre académie
Je cherche des renseignements avant de décider
Pouvez-vous détailler votre offre de formation ?
Que dois-je savoir sur la formation ?
Expliquez-moi ce que propose votre formation
J'ai besoin d'une information sur vos services
Donnez-moi quelques renseignements svp`,
 TRAINING_LIST:`Quels programmes peut-on suivre chez vous ?
Pouvez-vous énumérer les formations proposées ?
Avez-vous un catalogue actualisé à consulter ?
La liste de vos formations m'intéresse
Quels cours sont proposés actuellement ?
Je voudrais comparer vos différentes formations
Montrez-moi toutes les formations du centre
Il existe quelles formations dans votre académie ?`,
 ENGLISH_TRAINING:`Vous donnez des cours d'anglais ?
Je souhaite découvrir votre anglais
L'anglais m'intéresse pour travailler
English please, what do you offer?
Je suis débutant en anglais
Je veux progresser en anglais oral
Vous avez de l'anglais pour adultes ?
Peut-on apprendre l'anglais chez vous ?`,
 PRICING:`Quel budget prévoir pour un niveau ?
À combien revient votre formation complète ?
Vous demandez combien pour le cours ?
Donnez-moi le montant du tarif par niveau
Le prix annoncé couvre les trois niveaux ?
Que coûte le parcours entier ?
Votre tarif est exprimé en dollars ?
Combien coûte un seul niveau chez NVA ?`,
 PAYMENT_TERMS:`Est-il possible de régler en deux versements ?
Les trente dollars suffisent pour poursuivre ?
Le reste doit être payé avant quelle étape ?
Je peux régler le solde après la dernière séance ?
Faut-il payer soixante dollars dès le départ ?
Quel acompte exigez-vous après les essais ?
Vous autorisez un paiement à cinquante pour cent ?
Jusqu'à quand puis-je conserver un solde impayé ?`,
 FREE_TRIAL:`Les séances offertes s'ajoutent-elles au programme ?
Puis-je tester sans sortir d'argent ?
Les cinq cours offerts sont compris dans le niveau un ?
Votre offre d'essai concerne combien de rencontres ?
Je veux profiter des cours gratuits avant de décider
Après l'essai gratuit il reste onze séances, c'est ça ?
Vous offrez vraiment les cinq premières séances ?
L'essai est-il accessible à un débutant ?`,
 TRAINING_DURATION:`Une séance prend combien de minutes ?
Il faut combien d'heures pour finir les trois niveaux ?
Combien y a-t-il de séances dans un niveau ?
Le parcours dure combien d'heures au total ?
Est-ce seize leçons pour chaque niveau ?
Les trois niveaux représentent quelle durée ?
Il y a bien quarante-huit séances dans le parcours ?
Une heure et demie par séance, c'est exact ?`,
 TRAINING_SCHEDULE:`Vous enseignez à quelles heures le week-end ?
Les cours ont lieu quels jours de la semaine ?
Un créneau du soir est-il proposé ?
Je voudrais connaître l'horaire du vendredi
Quelle plage horaire peut-on choisir ?
Le samedi matin est disponible dans le planning ?
Faites-vous cours à dix-huit heures ?
Est-ce possible de choisir entre matin et soir ?`,
 SESSION_START_DATE:`À quelle date le prochain groupe débute ?
La rentrée est prévue pour quel jour ?
Quand démarre le groupe suivant ?
Je cherche la date exacte de commencement
Le début de la session est déjà fixé ?
La formation commence-t-elle ce mois-ci ?
Quelle est la prochaine date de démarrage ?
Je peux connaître le jour du premier cours ?`,
 AVAILABLE_SESSIONS:`Quel groupe a encore de la place ?
Quelles sessions acceptent encore des candidats ?
Une session est-elle ouverte aux nouveaux ?
Je cherche les sessions disponibles cette semaine
Reste-t-il des places disponibles pour débutants ?
Les groupes sont-ils déjà complets ?
Les sessions ouvertes ont quelle capacité restante ?
Peut-on rejoindre une session disponible aujourd'hui ?`,
 CERTIFICATION:`Est-ce votre académie qui signe le certificat ?
Le certificat peut-il être délivré après le premier niveau ?
Quelles conditions pour obtenir le document de certification ?
Votre diplôme a une accréditation externe ?
Le certificat est reconnu dans le monde entier ?
Doit-on terminer tous les niveaux pour être certifié ?
S'agit-il d'un certificat NVA ou d'un diplôme d'État ?
Vous promettez une reconnaissance internationale ?`,
 CERTIFICATE_COST:`Quel supplément pour recevoir le certificat NVA ?
Combien dois-je prévoir pour le document de certification ?
Est-ce vingt dollars le prix du certificat final ?
Le certificat est-il payant séparément ?
Quel est le coût exact de votre attestation finale ?
Le tarif de délivrance du certificat m'intéresse
À combien revient uniquement le certificat ?
Le certificat coûte-t-il quelque chose en plus ?`,
 ONLINE_LEARNING:`Peut-on participer depuis une autre ville ?
Faut-il me déplacer dans vos locaux ?
Les séances sont à distance ou en classe ?
Il n'y a aucun cours en présentiel ?
Tout se déroule en ligne depuis chez soi ?
Je suis à Lubumbashi, puis-je suivre à distance ?
Votre centre fonctionne uniquement sur internet ?
Dois-je venir physiquement à l'académie ?`,
 TEACHING_METHOD:`Comment apprenez-vous à parler aux débutants ?
Quelle pédagogie convient à un adulte qui commence ?
Les séances comportent des exercices pratiques ?
Vos méthodes font-elles travailler la conversation ?
L'enseignant explique en français ?
Comment le professeur organise ses cours ?
La méthode comprend-elle des activités en direct ?
On apprend en petits groupes ou individuellement ?`,
 REGISTRATION:`Je souhaite rejoindre votre académie
Quelles démarches pour devenir étudiant ?
Je décide de m'inscrire maintenant
Aidez-moi à effectuer mon inscription svp
Quelles pièces faut-il pour m'inscrire ?
On peut commencer mon inscription ensemble ?
Je suis intéressé par une inscription immédiate
Comment réserver mon inscription au prochain groupe ?`,
 REGISTRATION_WEBSITE:`Je vais faire mon inscription moi-même sur votre site
Je préfère compléter le formulaire sur le site officiel
Vous pouvez m'inscrire via le site internet ?
Je choisis votre site pour m'inscrire
Mon inscription passera par le site web
Via le site officiel, ça me convient
Pour m'inscrire je préfère votre site internet
Je préfère quitter le chat et utiliser le site`,
 REGISTRATION_WHATSAPP:`Je choisis WhatsApp pour mon inscription
Je préfère remplir les détails sur WhatsApp avec vous
Mon inscription doit se faire via WhatsApp
Pour m'inscrire, restons sur WhatsApp
Je vais m'inscrire avec votre aide sur WhatsApp
Via WhatsApp serait plus pratique pour moi
Inscrivez-moi directement par WhatsApp svp
Je préfère l'assistance WhatsApp pour cette demande`,
 REGISTRATION_STATUS:`Où en est ma demande d'inscription envoyée hier ?
Je voudrais le statut de mon inscription en cours
Ma demande est-elle encore en attente ?
Comment obtenir le suivi de mon inscription ?
Pouvez-vous vérifier le statut d'inscription ?
Ma demande d'inscription est toujours en attente de validation ?
J'attends le statut de ma demande
Je cherche le suivi de mon inscription précédente`,
 HUMAN_ADVISOR:`Pouvez-vous passer la main à un responsable ?
J'aimerais échanger avec une personne réelle
Mettez-moi en relation avec un conseiller d'admission
Je n'ai pas reçu mon reçu après paiement, aidez-moi
J'ai besoin d'une intervention administrative sur mon dossier
Je demande un conseiller pour résoudre mon cas
Je veux parler à un être humain maintenant
Il y a un souci administratif sur mon compte`,
 THANKS:`Un grand merci pour toutes ces précisions
Merci, vous avez répondu à mes interrogations
C'est très clair, je vous remercie
Merci bien pour votre temps
Parfait, merci à l'équipe NVA
Merci pour votre aide précieuse
Je vous remercie beaucoup pour l'explication
Super merci, cela me rassure`,
 GOODBYE:`Je vous laisse, à demain
À très bientôt et bonne journée
Bonne fin de journée à votre équipe
Au revoir, je reviendrai après réflexion
Passez une excellente soirée
On se reparle bientôt, au revoir
Je reviendrai demain, à bientôt
Bonne soirée, je dois partir maintenant`,
 UNKNOWN:`Quel smartphone acheter pour ma mère ?
Quelle équipe a remporté le championnat ?
Peux-tu me prêter de l'argent ?
Où puis-je acheter un billet d'avion ?
Je cherche une recette de pain facile
Répare mon téléphone s'il te plaît
Qui sera le président demain ?
Raconte-moi une blague amusante`,
};
const items=Object.entries(groups).flatMap(([intent,lines])=>lines.split('\n').map(text=>({text,intents:[intent]})));
const multiple=[
 ['Donnez-moi les tarifs ainsi que les horaires',['PRICING','TRAINING_SCHEDULE']],
 ['Quel est le prix et la date de début ?',['PRICING','SESSION_START_DATE']],
 ['Je voudrais la durée et le coût total',['TRAINING_DURATION','PRICING']],
 ['Puis-je payer la moitié et profiter de l’essai gratuit ?',['PAYMENT_TERMS','FREE_TRIAL']],
 ['Vos cours sont en ligne et quelle méthode utilisez-vous ?',['ONLINE_LEARNING','TEACHING_METHOD']],
 ['Le prix du certificat et les horaires du samedi svp',['CERTIFICATE_COST','TRAINING_SCHEDULE']],
 ['Les sessions disponibles et la date de début m’intéressent',['AVAILABLE_SESSIONS','SESSION_START_DATE']],
 ['Combien coûte la formation et est-ce certifiant ?',['PRICING','CERTIFICATION']],
];
const ambiguous=['Oui ça me convient','Je prends celle-là','Je choisis le second','Quarante ou soixante ?','Lequel est le mieux ?','Et pour moi alors ?','Je veux continuer','Vous pouvez préciser ça ?'].map(text=>({text,intents:['UNKNOWN'],clarification:true}));
const contextual=[
 ['La première méthode me convient',['REGISTRATION_WEBSITE']],
 ['La seconde, avec votre aide',['REGISTRATION_WHATSAPP']],
 ['D’accord, je prends la deuxième option',['REGISTRATION_WHATSAPP']],
 ['Option numéro un',['REGISTRATION_WEBSITE']],
 ['Choisissons la deuxième',['REGISTRATION_WHATSAPP']],
 ['Je prends la première',['REGISTRATION_WEBSITE']],
 ['Le deuxième choix s’il vous plaît',['REGISTRATION_WHATSAPP']],
 ['La première option finalement',['REGISTRATION_WEBSITE']],
].map(([text,intents])=>({text,intents,context:{registrationMethod:true}}));
module.exports=[...items,...multiple.map(([text,intents])=>({text,intents})),...ambiguous,...contextual];
