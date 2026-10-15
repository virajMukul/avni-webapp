import { AddressLevel, Gender, Observation, QuestionGroup } from "avni-models";
import { RepeatableQuestionGroup } from "openchs-models";
import { compact, isArray, isEmpty, isNil, keyBy, map, some, toPairs } from "lodash";

const KEY_PREFIX = "avni.registrationDraft";
const SCHEMA_VERSION = 1;
const MAX_AGE_IN_MS = 7 * 24 * 60 * 60 * 1000;

export const draftKey = ({ username, subjectTypeName, subjectUuid }) =>
  `${KEY_PREFIX}.${username || "unknown"}.${isEmpty(subjectUuid) ? subjectTypeName : subjectUuid}`;

const toIsoDate = (value) => (isNil(value) ? null : new Date(value).toISOString());

const toDate = (value) => (isNil(value) ? null : new Date(value));

export const toDraft = (subject) => ({
  firstName: subject.firstName,
  middleName: subject.middleName,
  lastName: subject.lastName,
  registrationDate: toIsoDate(subject.registrationDate),
  dateOfBirth: toIsoDate(subject.dateOfBirth),
  gender: isNil(subject.gender) ? null : { uuid: subject.gender.uuid, name: subject.gender.name },
  address: isNil(subject.lowestAddressLevel?.uuid)
    ? null
    : {
        uuid: subject.lowestAddressLevel.uuid,
        name: subject.lowestAddressLevel.name,
        type: subject.lowestAddressLevel.type,
        titleLineage: subject.lowestAddressLevel.titleLineage,
      },
  observations: map(subject.observations, (observation) => observation.toResource),
});

// Every field is a string, array, object or null, so isEmpty covers all of them.
export const hasAnyAnswer = (draft) =>
  some([draft.observations, draft.firstName, draft.lastName, draft.dateOfBirth, draft.gender, draft.address], (value) => !isEmpty(value));

export const writeDraft = (key, draft) => {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...draft,
        schemaVersion: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    // A draft is a safety net - a private window, blocked site data or an
    // exceeded quota must never surface as a failure in the form itself.
  }
};

export const readDraft = (key) => {
  try {
    const stored = localStorage.getItem(key);
    if (isNil(stored)) return null;
    const draft = JSON.parse(stored);
    const isStale = draft.schemaVersion !== SCHEMA_VERSION || Date.now() - new Date(draft.savedAt).getTime() > MAX_AGE_IN_MS;
    if (isStale) {
      clearDraft(key);
      return null;
    }
    return draft;
  } catch (error) {
    clearDraft(key);
    return null;
  }
};

export const clearDraft = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    // See writeDraft.
  }
};

export const applyDraft = (subject, draft, registrationForm) => {
  subject.firstName = draft.firstName;
  subject.middleName = draft.middleName;
  subject.lastName = draft.lastName;
  if (!isNil(draft.registrationDate)) subject.registrationDate = toDate(draft.registrationDate);
  subject.dateOfBirth = toDate(draft.dateOfBirth);

  if (!isNil(draft.gender)) {
    const gender = new Gender();
    gender.uuid = draft.gender.uuid;
    gender.name = draft.gender.name;
    subject.gender = gender;
  }

  if (!isNil(draft.address)) {
    const addressLevel = new AddressLevel();
    addressLevel.uuid = draft.address.uuid;
    addressLevel.name = draft.address.name;
    addressLevel.type = draft.address.type;
    addressLevel.titleLineage = draft.address.titleLineage;
    subject.lowestAddressLevel = addressLevel;
  }

  const conceptByUuid = keyBy(registrationForm.getAllFormElementConcepts(), "uuid");
  subject.observations = compact(
    map(draft.observations, ({ conceptUUID, value }) => buildObservation(conceptByUuid[conceptUUID], value, conceptByUuid)),
  );

  return subject;
};

// Concept.getValueWrapperFor consumes the server's observation shape, where a
// question group arrives as live child observations. A draft stores
// Observation.toResource instead, which flattens a group to {conceptUUID: value},
// so feeding that to QuestionGroup.fromObs silently yields an empty group. Groups
// are therefore rebuilt from their own concepts here; every other datatype
// round-trips through getValueWrapperFor unchanged.
const buildObservation = (concept, value, conceptByUuid) => {
  // The concept may have been removed from the form since the draft was written.
  if (isNil(concept) || isNil(value)) return null;

  const observation = new Observation();
  observation.concept = concept;
  observation.setValue(
    !concept.isQuestionGroup()
      ? concept.getValueWrapperFor(value)
      : isArray(value)
        ? new RepeatableQuestionGroup(map(value, (group) => buildQuestionGroup(group, conceptByUuid)))
        : buildQuestionGroup(value, conceptByUuid),
  );
  return observation;
};

const buildQuestionGroup = (groupResource, conceptByUuid) =>
  new QuestionGroup(
    compact(
      map(toPairs(groupResource), ([childConceptUuid, childValue]) =>
        buildObservation(conceptByUuid[childConceptUuid], childValue, conceptByUuid),
      ),
    ),
  );
