import { httpClient as http } from "common/utils/httpClient";
import { filter, get, isNil, keyBy, map, mapValues } from "lodash";

const REALLY_OLD_DATE = "1900-01-01T00:00:00.000Z";

export const ApprovalStatuses = {
  Pending: "Pending",
  Approved: "Approved",
  Rejected: "Rejected",
};

const syncParams = () => ({
  lastModifiedDateTime: REALLY_OLD_DATE,
  now: new Date().toISOString(),
  page: 0,
  size: 200,
});

const firstCollection = (body) => Object.values(get(body, "_embedded", {}))[0] ?? [];

// The approval status is delivered as a HAL link rather than a field, so the
// uuid has to be resolved against the three configured statuses.
const getStatusNameByUuid = async () => {
  const body = await http.getData(
    http.withParams("/approvalStatus/search/lastModified", {
      lastModifiedDateTime: REALLY_OLD_DATE,
      page: 0,
      size: 20,
    }),
  );
  return mapValues(keyBy(firstCollection(body), "uuid"), "status");
};

export const getApprovals = async () => {
  const [statusNameByUuid, body] = await Promise.all([
    getStatusNameByUuid(),
    http.getData(http.withParams("/entityApprovalStatus", syncParams())),
  ]);

  return map(firstCollection(body), (approval) => {
    const individual = get(approval, "individual", {});
    return {
      uuid: approval.uuid,
      entityType: approval.entityType,
      entityUuid: get(approval, "_links.entityUUID.href"),
      entityTypeUuid: approval.entityTypeUuid,
      status: statusNameByUuid[get(approval, "_links.approvalStatusUUID.href")],
      comment: approval.approvalStatusComment,
      statusDateTime: approval.statusDateTime,
      subjectName: [individual.firstName, individual.middleName, individual.lastName].filter((part) => !isNil(part)).join(" "),
    };
  });
};

export const countApprovalsByStatus = async (statusName) =>
  filter(await getApprovals(), (approval) => approval.status === statusName).length;
