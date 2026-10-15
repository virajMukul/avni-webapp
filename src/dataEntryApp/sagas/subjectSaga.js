import { Individual, ObservationsHolder, StaticFormElementGroup } from "avni-models";
import {
  onLoadSuccess,
  saveComplete,
  saveCompleteFalse,
  selectAddressLevelType,
  selectAvailableDraft,
  selectDraftKey,
  selectIdentifierAssignments,
  selectRegistrationForm,
  selectRegistrationState,
  setAvailableDraft,
  setFilteredFormElements,
  setInitialSubjectState,
  setRegistrationForm,
  setState as setRegistrationState,
  types as subjectTypes,
} from "../reducers/registrationReducer";
import SubjectSearchService from "../services/SubjectSearchService";
import { setSubjects, types as searchTypes } from "../reducers/searchReducer";
import { all, call, fork, put, select, takeEvery, takeLatest } from "redux-saga/effects";
import api from "../api";
import { getGenders } from "../reducers/metadataReducer";
import { getAPIErrorMessage } from "./sagaUtils";
import {
  selectRegistrationFormMappingForSubjectType,
  selectRegistrationProfilePictureFile,
  selectRegistrationRemoveProfilePicture,
  selectRegistrationSubject,
  selectSubjectTypeFromName,
} from "./selectors";
import { mapForm } from "../../common/adapters";
import { setLoad } from "../reducers/loadReducer";
import { find, get, isNil, keys, sortBy } from "lodash";
import { mapProfile } from "common/subjectModelMapper";
import { selectDecisions, selectVisitSchedules } from "dataEntryApp/reducers/serverSideRulesReducer";
import commonFormUtil from "dataEntryApp/reducers/commonFormUtil";
import Wizard from "dataEntryApp/state/Wizard";
import { filterFormElements } from "dataEntryApp/services/FormElementService";
import identifierAssignmentService from "dataEntryApp/services/IdentifierAssignmentService";
import { MediaFolder, uploadImage } from "../../common/utils/S3Client";
import { delay } from "redux-saga";
import {
  applyDraft,
  clearDraft,
  draftKey,
  hasAnyAnswer,
  readDraft,
  toDraft,
  writeDraft,
} from "dataEntryApp/services/RegistrationDraftService";

export function* dataEntryLoadRegistrationFormWatcher() {
  yield takeLatest(subjectTypes.GET_REGISTRATION_FORM, dataEntryLoadRegistrationFormWorker);
}

function* dataEntryLoadRegistrationFormWorker({ subjectTypeName }) {
  const formMapping = yield select(selectRegistrationFormMappingForSubjectType(subjectTypeName));
  const registrationForm = yield call(api.fetchForm, formMapping.formUUID);
  yield put(setRegistrationForm(mapForm(registrationForm)));
}

export function* dataEntrySearchWatcher() {
  yield takeLatest(searchTypes.SEARCH_SUBJECTS, dataEntrySearchWorker);
}

function* dataEntrySearchWorker({ params }) {
  yield put.resolve(setLoad(false));
  const subjects = yield call(SubjectSearchService.search, params);
  yield put(setSubjects(subjects));
  yield put.resolve(setLoad(true));
}

export function* saveSubjectWatcher() {
  yield takeLatest(subjectTypes.SAVE_SUBJECT, saveSubjectWorker);
}

export function* saveSubjectWorker() {
  const subject = yield select(selectRegistrationSubject);
  const visitSchedules = yield select(selectVisitSchedules);
  const decisions = yield select(selectDecisions);
  const registrationForm = yield select(selectRegistrationForm);
  const identifierAssignments = yield select(selectIdentifierAssignments);
  const profilePictureFile = yield select(selectRegistrationProfilePictureFile);
  const removeProfilePicFile = yield select(selectRegistrationRemoveProfilePicture);
  const [profilePicKey, error] = yield call(uploadImage, subject.profilePicture, profilePictureFile, MediaFolder.PROFILE_PICS);
  if (error) {
    yield put(saveCompleteFalse(error));
    return;
  }
  subject.profilePicture = removeProfilePicFile ? null : profilePicKey;
  let resource = subject.toResource;
  resource.visitSchedules = visitSchedules;
  resource.decisions = decisions;
  resource.identifierAssignmentUuids = identifierAssignmentService.getIdentifierAssignmentUuids(
    registrationForm,
    subject.observations,
    identifierAssignments,
  );

  try {
    const response = yield call(api.saveSubject, resource);
    if (response.success) {
      const key = yield select(selectDraftKey);
      if (!isNil(key)) clearDraft(key);
      yield put(saveComplete());
    } else {
      yield put(saveCompleteFalse(response.errorMessage));
    }
  } catch (e) {
    yield put(saveCompleteFalse(getAPIErrorMessage(e)));
  }
}

function* loadNewRegistrationPageWatcher() {
  yield takeLatest(subjectTypes.ON_LOAD, loadNewRegistrationPageWorker);
}

export function* loadNewRegistrationPageWorker({ subjectTypeName }) {
  yield put.resolve(setInitialSubjectState());
  yield put.resolve(setFilteredFormElements());

  const subjectType = yield select(selectSubjectTypeFromName(subjectTypeName));
  if (subjectType.isPerson()) {
    yield put.resolve(getGenders());
  }
  let subject = Individual.createEmptySubjectInstance();
  subject.subjectType = subjectType;

  const formMapping = yield select(selectRegistrationFormMappingForSubjectType(subjectTypeName));
  const registrationFormJson = yield call(api.fetchForm, formMapping.formUUID);
  const registrationForm = mapForm(registrationFormJson);

  const identifierAssignments = yield call(api.fetchIdentifierAssignments, formMapping.formUUID);
  identifierAssignmentService.addIdentifiersToObservations(registrationForm, subject.observations, identifierAssignments);
  yield setRegistrationOnLoadState(registrationForm, subject, identifierAssignments);
  yield call(detectDraftWorker, null);
}

function* loadEditRegistrationPageWatcher() {
  yield takeLatest(subjectTypes.ON_LOAD_EDIT, loadEditRegistrationPageWorker);
}

export function* loadEditRegistrationPageWorker({ subjectUuid }) {
  yield put.resolve(setInitialSubjectState());
  yield put.resolve(setFilteredFormElements());

  const subjectProfileJson = yield call(api.fetchSubjectProfile, subjectUuid);
  const subject = mapProfile(subjectProfileJson);
  const selectedAddressLevelType = subjectProfileJson.addressLevelTypeName
    ? { name: subjectProfileJson.addressLevelTypeName, id: subjectProfileJson.addressLevelTypeId }
    : { id: -1, name: "" };
  yield put(selectAddressLevelType(selectedAddressLevelType));

  const formMapping = yield select(selectRegistrationFormMappingForSubjectType(subject.subjectType.name));
  const registrationFormJson = yield call(api.fetchForm, formMapping.formUUID);
  const registrationForm = mapForm(registrationFormJson);

  if (subject.subjectType.isPerson()) {
    yield put.resolve(getGenders());
  }
  yield setRegistrationOnLoadState(registrationForm, subject, []);
  yield call(detectDraftWorker, subjectUuid);
}

export function* setRegistrationOnLoadState(registrationForm, subject, identifierAssignments) {
  const formElementGroup = new StaticFormElementGroup(registrationForm);
  const wizard = new Wizard(isNil(registrationForm) ? 1 : registrationForm.numberOfPages + 1, 2);
  const filteredFormElements = [];
  const onSummaryPage = false;
  const firstGroupWithAtLeastOneVisibleElement = find(
    sortBy(registrationForm.nonVoidedFormElementGroups(), "displayOrder"),
    (formElementGroup) => filterFormElements(formElementGroup, subject).length !== 0,
  );
  const isFormEmpty = isNil(firstGroupWithAtLeastOneVisibleElement);

  yield put.resolve(
    onLoadSuccess(
      subject,
      registrationForm,
      formElementGroup,
      filteredFormElements,
      onSummaryPage,
      wizard,
      isFormEmpty,
      identifierAssignments,
    ),
  );
}

const DRAFT_WRITE_DEBOUNCE_IN_MS = 1200;

function* detectDraftWorker(subjectUuid) {
  const username = yield select((state) => get(state, "app.userInfo.username"));
  const subject = yield select(selectRegistrationSubject);
  const key = draftKey({
    username,
    subjectTypeName: get(subject, "subjectType.name"),
    subjectUuid,
  });
  yield put(setAvailableDraft(key, readDraft(key)));
}

// takeLatest cancels the previous task, so the delay debounces a burst of
// keystrokes into a single write. redux-saga 0.16 has no debounce effect.
function* draftWriteWorker() {
  yield call(delay, DRAFT_WRITE_DEBOUNCE_IN_MS);
  const key = yield select(selectDraftKey);
  if (isNil(key)) return;
  // While a draft is still on offer, typing must not overwrite the answers the
  // banner is offering to restore - the user has not chosen yet.
  const availableDraft = yield select(selectAvailableDraft);
  if (!isNil(availableDraft)) return;
  const state = yield select(selectRegistrationState);
  if (isNil(state.subject) || !state.loaded) return;
  const draft = toDraft(state.subject);
  if (hasAnyAnswer(draft)) writeDraft(key, draft);
}

function* draftWriteWatcher() {
  yield takeLatest(
    [
      subjectTypes.UPDATE_OBS,
      subjectTypes.SET_FIRST_NAME,
      subjectTypes.SET_MIDDLE_NAME,
      subjectTypes.SET_LAST_NAME,
      subjectTypes.SET_DATE_OF_BIRTH,
      subjectTypes.SET_GENDER,
      subjectTypes.SET_ADDRESS,
      subjectTypes.SET_REGISTRATION_DATE,
      subjectTypes.ADD_NEW_QG,
      subjectTypes.REMOVE_QG,
      subjectTypes.ON_NEXT,
      subjectTypes.ON_PREVIOUS,
    ],
    draftWriteWorker,
  );
}

function* restoreDraftWatcher() {
  yield takeLatest(subjectTypes.RESTORE_DRAFT, restoreDraftWorker);
}

export function* restoreDraftWorker() {
  const state = yield select(selectRegistrationState);
  const draft = yield select(selectAvailableDraft);
  if (isNil(draft) || isNil(state.subject)) return;

  // Only the subject is replaced: the wizard stays on its current page and the
  // next/previous workers recompute visible elements from the restored answers.
  const subject = applyDraft(state.subject.cloneForEdit(), draft, state.registrationForm);
  yield put(
    setRegistrationState({
      ...state,
      subject,
      availableDraft: null,
    }),
  );
}

function* discardDraftWatcher() {
  yield takeLatest(subjectTypes.DISCARD_DRAFT, discardDraftWorker);
}

export function* discardDraftWorker() {
  const key = yield select(selectDraftKey);
  if (!isNil(key)) clearDraft(key);
  yield put(setAvailableDraft(key, null));
}

function* updateObsWatcher() {
  yield takeEvery(subjectTypes.UPDATE_OBS, updateObsWorker);
}

export function* updateObsWorker({ formElement, value, childFormElement, questionGroupIndex }) {
  const state = yield select(selectRegistrationState);
  const subject = state.subject.cloneForEdit();
  const { validationResults, filteredFormElements } = commonFormUtil.updateObservations(
    formElement,
    value,
    subject,
    new ObservationsHolder(subject.observations),
    state.validationResults,
    childFormElement,
    questionGroupIndex,
  );
  yield put(
    setRegistrationState({
      ...state,
      filteredFormElements,
      subject,
      validationResults,
    }),
  );
}

function* addNewQuestionGroupWatcher() {
  yield takeEvery(subjectTypes.ADD_NEW_QG, addNewQuestionGroupWorker);
}
export function* addNewQuestionGroupWorker({ formElement }) {
  const state = yield select(selectRegistrationState);
  const subject = state.subject.cloneForEdit();
  const { filteredFormElements } = commonFormUtil.addNewQuestionGroup(subject, formElement, subject.observations);
  yield put(
    setRegistrationState({
      ...state,
      subject,
      filteredFormElements,
    }),
  );
}

function* removeQuestionGroupWatcher() {
  yield takeEvery(subjectTypes.REMOVE_QG, removeQuestionGroupWorker);
}
export function* removeQuestionGroupWorker({ formElement, questionGroupIndex }) {
  const state = yield select(selectRegistrationState);
  const subject = state.subject.cloneForEdit();
  const { filteredFormElements, validationResults } = commonFormUtil.removeQuestionGroup(
    subject,
    formElement,
    subject.observations,
    state.validationResults,
    questionGroupIndex,
  );
  yield put(
    setRegistrationState({
      ...state,
      subject,
      filteredFormElements,
      validationResults,
    }),
  );
}

export function* registrationNextWatcher() {
  yield takeLatest(subjectTypes.ON_NEXT, registrationWizardWorkerNext);
}

export function* registrationWizardWorkerNext() {
  const state = yield select(selectRegistrationState);
  const subject = state.subject.cloneForEdit();

  const { formElementGroup, filteredFormElements, validationResults, observations, onSummaryPage, wizard } = commonFormUtil.onNext({
    formElementGroup: state.formElementGroup,
    filteredFormElements: state.filteredFormElements,
    observations: subject.observations,
    entity: subject,
    validationResults: state.validationResults,
    onSummaryPage: state.onSummaryPage,
    wizard: state.wizard.clone(),
    entityValidations: subject.validate(),
    staticFormElementIds: state.wizard.isFirstPage() ? keys(Individual.validationKeys) : [],
  });

  subject.observations = observations;
  const nextState = {
    ...state,
    subject,
    formElementGroup,
    filteredFormElements,
    validationResults,
    onSummaryPage,
    wizard,
  };
  yield put(setRegistrationState(nextState));
}

export function* registrationPreviousWatcher() {
  yield takeLatest(subjectTypes.ON_PREVIOUS, registrationWizardWorkerPrev);
}

export function* registrationWizardWorkerPrev() {
  const state = yield select(selectRegistrationState);
  const subject = state.subject.cloneForEdit();

  const previousGroup = state.formElementGroup.previous();

  //The previousGroup is going to be null when we are going to the static page for any subject type.
  //In that case we need to set formElementGroup as static FEG and filteredFormElements as empty.
  const shouldGoToStaticPageForAllSubjectTypes = isNil(previousGroup) && !state.onSummaryPage;
  if (shouldGoToStaticPageForAllSubjectTypes) {
    const wizard = state.wizard.clone();
    wizard.movePrevious();
    const nextState = {
      ...state,
      formElementGroup: new StaticFormElementGroup(state.registrationForm),
      filteredFormElements: [],
      wizard,
    };
    yield put(setRegistrationState(nextState));
  } else {
    const { formElementGroup, filteredFormElements, validationResults, observations, onSummaryPage, wizard } = commonFormUtil.onPrevious({
      formElementGroup: state.formElementGroup,
      filteredFormElements: state.filteredFormElements,
      observations: subject.observations,
      entity: subject,
      validationResults: state.validationResults,
      onSummaryPage: state.onSummaryPage,
      wizard: state.wizard.clone(),
    });
    subject.observations = observations;
    const nextState = {
      ...state,
      subject,
      formElementGroup: formElementGroup,
      filteredFormElements,
      validationResults,
      onSummaryPage,
      wizard,
    };
    yield put(setRegistrationState(nextState));
  }
}

export default function* subjectSaga() {
  yield all(
    [
      dataEntrySearchWatcher,
      dataEntryLoadRegistrationFormWatcher,
      loadNewRegistrationPageWatcher,
      loadEditRegistrationPageWatcher,
      updateObsWatcher,
      addNewQuestionGroupWatcher,
      removeQuestionGroupWatcher,
      registrationNextWatcher,
      registrationPreviousWatcher,
      saveSubjectWatcher,
      draftWriteWatcher,
      restoreDraftWatcher,
      discardDraftWatcher,
    ].map(fork),
  );
}
