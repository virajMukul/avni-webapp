import { Fragment, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { styled } from "@mui/material/styles";
import {
  Alert,
  CircularProgress,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import { get, isEmpty, isNil } from "lodash";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { parseISO, isValid } from "date-fns";
import Breadcrumbs from "dataEntryApp/components/Breadcrumbs";
import {
  getCardResults,
  getDashboards,
} from "dataEntryApp/services/ReportCardService";

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3, 2),
  margin: theme.spacing(4),
  [theme.breakpoints.down("sm")]: {
    padding: theme.spacing(1.5, 1),
    margin: theme.spacing(1),
  },
}));

const findCard = (dashboards, cardUuid) => {
  for (const dashboard of dashboards)
    for (const section of dashboard.sections || [])
      for (const mapping of section.dashboardSectionCardMappings || [])
        if (get(mapping, "card.uuid") === cardUuid) return mapping.card;
  return null;
};

const CardResultList = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { cardUuid } = useParams();
  const [searchParams] = useSearchParams();
  const requestedDate = parseISO(searchParams.get("asOnDate") ?? "");
  const asOnDate = isValid(requestedDate) ? requestedDate : new Date();
  const operationalModules = useSelector(
    (state) => state.dataEntry.metadata.operationalModules,
  );
  const [card, setCard] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getDashboards()
      .then((dashboards) => {
        const found = findCard(dashboards, cardUuid);
        if (isNil(found)) throw new Error("That card no longer exists");
        setCard(found);
        return getCardResults(found, { asOnDate, operationalModules });
      })
      .then(setRows)
      .catch((loadError) =>
        setError(get(loadError, "message", "Could not load the list")),
      );
  }, [cardUuid, operationalModules]);

  if (!isNil(error))
    return (
      <StyledPaper>
        <Alert severity="error">{error}</Alert>
      </StyledPaper>
    );

  if (isNil(rows))
    return (
      <StyledPaper>
        <CircularProgress size={28} />
      </StyledPaper>
    );

  return (
    <Fragment>
      <Breadcrumbs path={location.pathname} />
      <StyledPaper>
        <Typography variant="h5" sx={{ mb: 2 }}>
          {t(get(card, "name", ""))}
        </Typography>
        {isEmpty(rows) ? (
          <Alert severity="info">{t("noResults", "Nothing to show.")}</Alert>
        ) : (
          <List dense>
            {rows.map((row) => (
              <ListItem key={row.key} divider disableGutters>
                <ListItemText
                  primary={
                    isNil(row.subjectUuid) ? (
                      row.subjectName || t("unknownSubject", "Unknown subject")
                    ) : (
                      <Link href={`/#/app/subject?uuid=${row.subjectUuid}`}>
                        {row.subjectName ||
                          t("unknownSubject", "Unknown subject")}
                      </Link>
                    )
                  }
                  secondary={row.detail.join(" · ")}
                  sx={{ wordBreak: "break-word" }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </StyledPaper>
    </Fragment>
  );
};

export default CardResultList;
