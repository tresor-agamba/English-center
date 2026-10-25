// Separately maintained evaluation phrases. No expansion or generated paraphrases.
// A local authored corpus, not a claim of independent field validation.
const groups={
 GREETING:`Bonjour
Salut
Bonsoir
Hello
Coucou
Bonjour NVA
BONJOUR !
salut nva
Bonsoir NVA
Hello NVA`,
 MAIN_MENU:`Menu
Accueil
Retour au menu
MENU !
menu.
ACCUEIL
retour au menu !
Menu ?
accueil.
retour au menu.`,
 PRICING:`Combien coûte la formation ?
Quel est le prix ?
Vos tarifs ?
C'est quoi le coût ?
Combien ça coûte ?
Le prix du cours ?
Quel tarif pour commencer ?
Je voudrais connaître les tarifs
Le coût total ?
Parlez-moi du prix`,
 PAYMENT_TERMS:`Je peux payer la moitié ?
Quand dois-je terminer le paiement ?
Quel est le solde ?
Puis-je verser un acompte ?
Quelle échéance pour le solde ?
Comment payer ?
Vous acceptez un paiement fractionné ?
Je paie en plusieurs fois ?
Je dois payer avant la fin ?
Quand régler le solde ?`,
 FREE_TRIAL:`Vous êtes gratuits ?
Je veux essayer gratuitement
Les cinq séances sont en plus ?
Comment bénéficier de l'essai ?
Vos cours sont gratuits ?
Je voudrais un essai
Je peux essayer ?
Les 5 séances font partie du niveau ?
L'essai est-il gratuit ?
Vous proposez un essai gratuit ?`,
 TRAINING_DURATION:`Combien de niveaux existe-t-il ?
Et ça dure combien de temps ?
Quelle est la durée ?
Combien de séances par niveau ?
Nombre de niveaux ?
Ça dure longtemps ?
Combien de temps pour finir ?
Nombre de séances au total ?
La durée complète ?
Combien de séances en tout ?`,
 CERTIFICATE_COST:`Combien coûte le certificat ?
Le prix du certificat ?
Certificat : quel tarif ?
Coût du certificat ?
Quel est le tarif du certificat ?
Certificat, son prix ?
Combien pour le certificat ?
Je veux savoir le prix du certificat
Le certificat coûte combien ?
Votre certificat : coût ?`,
 CERTIFICATION:`Votre certificat est-il international ?
Vous délivrez un diplôme ?
La certification est reconnue ?
Qui délivre le certificat ?
Quand obtenir mon certificat ?
Le certificat vient de qui ?
Il y a une accréditation ?
Puis-je recevoir un certificat ?
Est-ce certifiant ?
Un diplôme officiel ?`,
 TRAINING_SCHEDULE:`Quels sont les horaires disponibles ?
Quels jours ?
Les créneaux ?
Quel est le planning ?
Votre emploi du temps ?
Quels horaires le soir ?
Horaires du matin ?
Quel créneau choisir ?
Je cherche vos horaires
Vos créneaux du samedi ?`,
 SESSION_START_DATE:`Quand commence la prochaine session ?
Quand commence-t-on ?
Date de début ?
Le démarrage est prévu quand ?
La prochaine session ?
Vous commencez quand ?
Quand démarrent les cours ?
Quel jour de début ?
Le cours commence bientôt ?
Quand est le début ?`,
 AVAILABLE_SESSIONS:`Quelles sessions sont ouvertes ?
Sessions disponibles ?
Il reste des places disponibles ?
Une session ouverte ?
Les sessions sont-elles disponibles ?
Je cherche une session disponible
Quelles sessions ouvertes avez-vous ?
Des places disponibles ?
Vos sessions disponibles actuellement ?
Y a-t-il une session ouverte ?`,
 REGISTRATION:`Je veux m'inscrire
Comment faire mon inscription ?
Je souhaite une inscription
Inscrivez-moi
Je voudrais m'inscrire maintenant
Je suis prêt à m'inscrire
Je peux m'inscrire ?
L'inscription se fait comment ?
Besoin d'aide pour m'inscrire
Je confirme mon souhait d'inscription`,
 REGISTRATION_WEBSITE:`Je préfère votre site
Je vais m'inscrire sur le site
Via le site
Je préfère le site internet
Inscription sur votre site
Je préfère passer par le site
Je veux m'inscrire via votre site
Via votre site officiel
Je préfère utiliser le site
Inscrire sur le site web`,
 REGISTRATION_WHATSAPP:`Je préfère WhatsApp
Via WhatsApp
Je veux m'inscrire sur WhatsApp
Inscription via WhatsApp
Je préfère rester sur WhatsApp
Je préfère votre WhatsApp
Via votre WhatsApp
Je souhaite m'inscrire par WhatsApp
Je préfère utiliser WhatsApp
Je vais m'inscrire ici via WhatsApp`,
 HUMAN_ADVISOR:`Je veux parler à quelqu'un
Un conseiller svp
Je veux un humain
Une conseillère disponible ?
J'ai un problème de paiement
Question administrative
Passez-moi un conseiller
Je souhaite parler à quelqu'un
Votre conseiller peut m'aider ?
Une intervention administrative svp`,
 ONLINE_LEARNING:`Est-ce en ligne ?
Vous faites du présentiel ?
Je peux apprendre à distance ?
Tout est en ligne ?
Vous êtes à distance ?
En ligne ou sur place ?
Je cherche du présentiel
C'est à distance ?
Vous travaillez en ligne ?
Je peux suivre à distance ?`,
 TEACHING_METHOD:`Quelle méthode utilisez-vous ?
Comment se passent les cours ?
Votre pédagogie ?
Comment enseignez-vous ?
La méthode est pratique ?
Comment suivre les cours ?
Quelle approche pédagogique ?
Qui enseigne ?
Expliquez votre méthode
Comment fonctionnent les cours ?`,
 TRAINING_LIST:`Quelles formations proposez-vous ?
Nos formations
Le catalogue ?
Quelles sont vos formations ?
Votre catalogue
Quelles autres formations ?
Je veux voir le catalogue
Présentez nos formations
Quelles formations disponibles ?
Montrez le catalogue`,
 THANKS:`Merci
Merci beaucoup
OK merci
MERCI !
merci.
Merci beaucoup !
ok, merci
MERCI BEAUCOUP
Merci !
Ok merci.`,
 GOODBYE:`Au revoir
À bientôt
Bonne soirée
Merci et au revoir
À très bientôt
Je vous dis au revoir
Bonne soirée à vous
Au revoir NVA
À bientôt NVA
Bonne soirée !`,
 UNKNOWN:`Quel temps fait-il ?
Où est mon colis ?
Recette de cuisine
Qui a gagné le match ?
Je cherche un taxi
Quelle est la capitale du Pérou ?
Mon ordinateur ne démarre plus
Raconte une histoire
Peux-tu jouer une chanson ?
Quel est ton animal favori ?`,
};
module.exports=Object.entries(groups).flatMap(([intent,lines])=>lines.split('\n').map(text=>({text,intents:[intent]})));
