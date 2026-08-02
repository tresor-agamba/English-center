const { isCertainTestFixture } = require('../utils/testFixtureIdentity');

const textPresent = (value) => typeof value === 'string' && value.trim().length > 0;

function publicationMissingFields(course) {
  const missing = [];
  if (!textPresent(course.title)) missing.push('Titre');
  if (!textPresent(course.shortDescription) && !textPresent(course.description)) missing.push('Description publique');
  if (!textPresent(course.level)) missing.push('Niveau');
  if (!(Number(course.durationValue) > 0 && course.durationUnit) && !textPresent(course.duration)) missing.push('Durée ou structure');
  if (!(course.pricingActive && course.pricingMode && Number(course.price) > 0 && textPresent(course.currency))) missing.push('Tarif actif');
  return missing;
}

function isPublicationReady(course) {
  return publicationMissingFields(course).length === 0 && !isCertainTestFixture(course);
}

function isPublicCourse(course) {
  return course.isPublished === true && course.lmsStatus === 'PUBLISHED' &&
    !course.archivedAt && !course.closedAt && isPublicationReady(course);
}

function publicationState(course) {
  if (course.archivedAt || course.lmsStatus === 'ARCHIVED') return 'ARCHIVED';
  if (isPublicCourse(course)) return 'PUBLISHED';
  if (!isPublicationReady(course)) return 'INCOMPLETE';
  return 'READY';
}

module.exports = { publicationMissingFields, isPublicationReady, isPublicCourse, publicationState };
