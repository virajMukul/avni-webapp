import { httpClient as http } from "common/utils/httpClient";
import { Form, StandardReportCardType } from "openchs-models";
import { endOfDay, format, startOfDay, sub } from "date-fns";
import { filter, get, isEmpty, isNil, keyBy, map, mapValues, sum, uniq } from "lodash";
import { ApprovalStatuses, countApprovalsByStatus, getApprovals } from "dataEntryApp/services/ApprovalService";

const { types } = StandardReportCardType;

const REALLY_OLD_DATE = "1900-01-01T00:00:00.000Z";
const SYNC_PAGE_SIZE = 200;
const SEARCH_DATE_FORMAT = "yyyy-MM-dd";

export const getDashboards = () => http.getData("/web/dashboard");

const recentCutoff = (card, asOnDate) => {
  const duration = card.standardReportCardInputRecentDuration;
  return sub(asOnDate, {
    [get(duration, "unit", "days")]: Number(get(duration, "value", 1)),
  });
};

const recentRange = (card, asOnDate) => ({
  minValue: format(recentCutoff(card, asOnDate), SEARCH_DATE_FORMAT),
  maxValue: format(asOnDate, SEARCH_DATE_FORMAT),
});

const searchCount = (subjectTypeUuid, dateField, dateRange) => {
  const request = {
    includeVoided: false,
    includeDisplayCount: true,
    pageElement: { pageNumber: 0, numberOfRecordPerPage: 1 },
  };
  if (!isNil(subjectTypeUuid)) request.subjectType = subjectTypeUuid;
  if (!isNil(dateField)) request[dateField] = dateRange;
  return http.post("/web/searchAPI/v2", request).then((response) => get(response, "data.totalElements", 0));
};

// An empty standardReportCardInputSubjectTypes means "every subject type", which
// searchAPI expresses by omitting the filter altogether.
const countViaSearch = async (card, dateField, dateRange) => {
  const uuids = map(card.standardReportCardInputSubjectTypes, "uuid");
  return sum(await Promise.all((isEmpty(uuids) ? [null] : uuids).map((uuid) => searchCount(uuid, dateField, dateRange))));
};

const fetchAllPages = async (resource, params) => {
  const rows = [];
  let page = 0;
  let totalPages = 1;
  do {
    const body = await http.getData(
      http.withParams(`/${resource}`, {
        lastModifiedDateTime: REALLY_OLD_DATE,
        now: new Date().toISOString(),
        ...params,
        page,
        size: SYNC_PAGE_SIZE,
      }),
    );
    const batch = Object.values(get(body, "_embedded", {}))[0] ?? [];
    rows.push(...batch);
    totalPages = get(body, "page.totalPages", 1);
    page += 1;
    if (isEmpty(batch)) break;
  } while (page < totalPages);
  return rows;
};

// An encounter type reached through the wrong endpoint is a server error, not an
// empty result: /programEncounter answers "No form mapping found" for a type
// mapped only as a general Encounter. Form mappings decide which is which.
const encounterTypeUuidsByFormType = (operationalModules, formType) =>
  uniq(
    get(operationalModules, "formMappings", [])
      .filter((mapping) => mapping.formType === formType && mapping.encounterTypeUUID)
      .map((mapping) => mapping.encounterTypeUUID),
  );

const isOpenVisit = (visit) => !visit.voided && isNil(visit.encounterDateTime) && isNil(visit.cancelDateTime);

// Mirrors IndividualService.allScheduledVisitsIn / allOverdueVisitsIn on the
// field app, which filter the device database on the same four fields.
const isScheduled = (visit, asOnDate) =>
  isOpenVisit(visit) &&
  !isNil(visit.earliestVisitDateTime) &&
  new Date(visit.earliestVisitDateTime) <= endOfDay(asOnDate) &&
  !isNil(visit.maxVisitDateTime) &&
  new Date(visit.maxVisitDateTime) >= startOfDay(asOnDate);

const isOverdue = (visit, asOnDate) =>
  isOpenVisit(visit) && !isNil(visit.maxVisitDateTime) && new Date(visit.maxVisitDateTime) < startOfDay(asOnDate);

// searchAPI's encounterDate filter matches only general encounters - a 2020-2027
// range returns nothing while a completed program encounter exists - so recent
// visits are counted from the visit records, which covers both kinds.
const isRecentlyCompleted = (visit, asOnDate, cutoff) =>
  !visit.voided &&
  isNil(visit.cancelDateTime) &&
  !isNil(visit.encounterDateTime) &&
  new Date(visit.encounterDateTime) >= cutoff &&
  new Date(visit.encounterDateTime) <= endOfDay(asOnDate);

const findVisits = async (card, asOnDate, operationalModules, matches) => {
  const allowedUuids = map(card.standardReportCardInputEncounterTypes, "uuid");
  const restrict = (uuids) => (isEmpty(allowedUuids) ? uuids : filter(uuids, (uuid) => allowedUuids.includes(uuid)));

  const visitGroups = await Promise.all([
    ...map(restrict(encounterTypeUuidsByFormType(operationalModules, Form.formTypes.Encounter)), (uuid) =>
      fetchAllPages("encounter", { encounterTypeUuid: uuid }),
    ),
    ...map(restrict(encounterTypeUuidsByFormType(operationalModules, Form.formTypes.ProgramEncounter)), (uuid) =>
      fetchAllPages("programEncounter", { programEncounterTypeUuid: uuid }),
    ),
  ]);

  return filter(visitGroups.flat(), (visit) => matches(visit, asOnDate));
};

const countVisits = async (...args) => (await findVisits(...args)).length;

// searchAPI silently ignores an enrolmentDate filter - an impossible range still
// returns every subject - so recent enrolments are counted from the enrolment
// records themselves instead.
const findRecentEnrolments = async (card, asOnDate, operationalModules) => {
  const cutoff = recentCutoff(card, asOnDate);
  const allowedUuids = map(card.standardReportCardInputPrograms, "uuid");
  const programs = filter(get(operationalModules, "programs", []), ({ uuid }) => isEmpty(allowedUuids) || allowedUuids.includes(uuid));

  const enrolmentGroups = await Promise.all(map(programs, ({ uuid }) => fetchAllPages("programEnrolment", { programUuid: uuid })));

  return filter(
    enrolmentGroups.flat(),
    (enrolment) =>
      !enrolment.voided &&
      !isNil(enrolment.enrolmentDateTime) &&
      new Date(enrolment.enrolmentDateTime) >= cutoff &&
      new Date(enrolment.enrolmentDateTime) <= endOfDay(asOnDate),
  );
};

const countRecentEnrolments = async (...args) => (await findRecentEnrolments(...args)).length;

// Returns null for card types that still need their own data source - comment,
// task, checklist and fully custom cards. The tile renders without a number
// rather than showing a wrong one.
export const getCardCount = (card, { asOnDate = new Date(), operationalModules } = {}) => {
  switch (get(card, "standardReportCardType.type")) {
    case types.Total:
      return countViaSearch(card);
    case types.RecentRegistrations:
      return countViaSearch(card, "registrationDate", recentRange(card, asOnDate));
    case types.RecentVisits:
      return countVisits(card, asOnDate, operationalModules, (visit, date) =>
        isRecentlyCompleted(visit, date, recentCutoff(card, asOnDate)),
      );
    case types.RecentEnrolments:
      return countRecentEnrolments(card, asOnDate, operationalModules);
    case types.ScheduledVisits:
      return countVisits(card, asOnDate, operationalModules, isScheduled);
    case types.OverdueVisits:
      return countVisits(card, asOnDate, operationalModules, isOverdue);
    case types.PendingApproval:
      return countApprovalsByStatus(ApprovalStatuses.Pending);
    case types.Approved:
      return countApprovalsByStatus(ApprovalStatuses.Approved);
    case types.Rejected:
      return countApprovalsByStatus(ApprovalStatuses.Rejected);
    default:
      return Promise.resolve(null);
  }
};

const fullName = (individual) =>
  [individual.firstName, individual.middleName, individual.lastName].filter((part) => !isEmpty(part)).join(" ");

const linkedUuid = (row, name) => get(row, ["_links", name, "href"]);

// A visit row carries no subject, only _links.programEnrolmentUUID (program
// visits) or _links.individualUUID (general ones), so listing visits by subject
// needs both joins resolved here.
const getSubjectIndex = async (operationalModules) => {
  const [subjectGroups, enrolmentGroups] = await Promise.all([
    Promise.all(map(get(operationalModules, "subjectTypes", []), ({ uuid }) => fetchAllPages("individual", { subjectTypeUuid: uuid }))),
    Promise.all(map(get(operationalModules, "programs", []), ({ uuid }) => fetchAllPages("programEnrolment", { programUuid: uuid }))),
  ]);

  const subjectByUuid = keyBy(subjectGroups.flat(), "uuid");
  const subjectUuidByEnrolmentUuid = mapValues(keyBy(enrolmentGroups.flat(), "uuid"), (enrolment) =>
    linkedUuid(enrolment, "individualUUID"),
  );

  const resolve = (subjectUuid) => {
    const individual = subjectByUuid[subjectUuid];
    return { subjectUuid, subjectName: isNil(individual) ? null : fullName(individual) };
  };

  return { forSubject: resolve, forEnrolment: (enrolmentUuid) => resolve(subjectUuidByEnrolmentUuid[enrolmentUuid]) };
};

const VISIT_DATE_FIELD = {
  [types.OverdueVisits]: "maxVisitDateTime",
  [types.RecentVisits]: "encounterDateTime",
  [types.ScheduledVisits]: "earliestVisitDateTime",
};

const APPROVAL_STATUS_BY_CARD_TYPE = {
  [types.PendingApproval]: ApprovalStatuses.Pending,
  [types.Approved]: ApprovalStatuses.Approved,
  [types.Rejected]: ApprovalStatuses.Rejected,
};

const subjectRowsViaSearch = async (card, asOnDate, dateField) => {
  const uuids = map(card.standardReportCardInputSubjectTypes, "uuid");
  const request = { includeVoided: false, includeDisplayCount: false };
  if (uuids.length === 1) request.subjectType = uuids[0];
  if (!isNil(dateField)) request[dateField] = recentRange(card, asOnDate);

  const response = await http.post("/web/searchAPI/v2", {
    ...request,
    pageElement: { pageNumber: 0, numberOfRecordPerPage: SYNC_PAGE_SIZE },
  });
  return map(get(response, "data.listOfRecords", []), (record) => ({
    key: record.uuid,
    subjectUuid: record.uuid,
    subjectName: record.fullName,
    detail: [record.subjectTypeName, record.addressLevel].filter((part) => !isEmpty(part)),
  }));
};

const visitRows = async (card, asOnDate, operationalModules, matches, cardType) => {
  const [visits, index] = await Promise.all([findVisits(card, asOnDate, operationalModules, matches), getSubjectIndex(operationalModules)]);
  return map(visits, (visit) => {
    const enrolmentUuid = linkedUuid(visit, "programEnrolmentUUID");
    return {
      key: visit.uuid,
      ...(isNil(enrolmentUuid) ? index.forSubject(linkedUuid(visit, "individualUUID")) : index.forEnrolment(enrolmentUuid)),
      detail: [visit.name, get(visit, VISIT_DATE_FIELD[cardType])].filter((part) => !isNil(part)),
    };
  });
};

// Rows behind a tile. Null for the card types getCardCount cannot compute
// either, so the tile stays unclickable rather than opening an empty list.
export const getCardResults = async (card, { asOnDate = new Date(), operationalModules } = {}) => {
  const cardType = get(card, "standardReportCardType.type");

  switch (cardType) {
    case types.Total:
      return subjectRowsViaSearch(card, asOnDate, null);
    case types.RecentRegistrations:
      return subjectRowsViaSearch(card, asOnDate, "registrationDate");
    case types.ScheduledVisits:
      return visitRows(card, asOnDate, operationalModules, isScheduled, cardType);
    case types.OverdueVisits:
      return visitRows(card, asOnDate, operationalModules, isOverdue, cardType);
    case types.RecentVisits:
      return visitRows(
        card,
        asOnDate,
        operationalModules,
        (visit, date) => isRecentlyCompleted(visit, date, recentCutoff(card, asOnDate)),
        cardType,
      );
    case types.RecentEnrolments: {
      const [enrolments, index] = await Promise.all([
        findRecentEnrolments(card, asOnDate, operationalModules),
        getSubjectIndex(operationalModules),
      ]);
      return map(enrolments, (enrolment) => ({
        key: enrolment.uuid,
        ...index.forSubject(linkedUuid(enrolment, "individualUUID")),
        detail: [enrolment.enrolmentDateTime].filter((part) => !isNil(part)),
      }));
    }
    case types.PendingApproval:
    case types.Approved:
    case types.Rejected: {
      const statusName = APPROVAL_STATUS_BY_CARD_TYPE[cardType];
      const approvals = await getApprovals();
      return map(
        filter(approvals, (approval) => approval.status === statusName),
        (approval) => ({
          key: approval.uuid,
          subjectUuid: approval.entityUuid,
          subjectName: approval.subjectName,
          detail: [approval.entityType, approval.comment].filter((part) => !isNil(part)),
        }),
      );
    }
    default:
      return null;
  }
};
