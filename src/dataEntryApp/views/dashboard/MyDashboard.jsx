import { Fragment, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { styled } from "@mui/material/styles";
import {
  Alert,
  Card,
  CardActionArea,
  CircularProgress,
  Grid,
  Paper,
  Typography,
} from "@mui/material";
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { format } from "date-fns";
import { get, isEmpty, isNil, sortBy } from "lodash";
import { dateFormat } from "dataEntryApp/constants";
import Breadcrumbs from "dataEntryApp/components/Breadcrumbs";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getCardCount,
  getDashboards,
} from "dataEntryApp/services/ReportCardService";

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3, 2),
  margin: theme.spacing(4),
  flexGrow: 1,
  [theme.breakpoints.down("sm")]: {
    padding: theme.spacing(1.5, 1),
    margin: theme.spacing(1),
  },
}));

const StyledTile = styled(Card)({
  borderRadius: 10,
  height: "100%",
  boxShadow: "none",
});

const StyledCount = styled(Typography)({
  fontSize: 28,
  fontWeight: 900,
  lineHeight: 1.2,
});

const ReportCardTile = ({ card, asOnDate, operationalModules }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [count, setCount] = useState(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getCardCount(card, { asOnDate, operationalModules })
      .then((value) => current && setCount(value))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [card, asOnDate, operationalModules]);

  const renderCount = () => {
    if (failed) return <StyledCount color="error">!</StyledCount>;
    if (count === undefined) return <CircularProgress size={22} />;
    // null means this card type has no web data source yet.
    if (isNil(count))
      return <StyledCount color="text.disabled">&ndash;</StyledCount>;
    return <StyledCount>{count}</StyledCount>;
  };

  return (
    <StyledTile sx={{ backgroundColor: card.color || "#E7F3F8" }}>
      <CardActionArea
        // A dash means the count could not be computed, so there is no list.
        disabled={isNil(count)}
        onClick={() => {
          // The list must answer for the same date the tile counted.
          navigate(
            `/app/dashboard/card/${card.uuid}?asOnDate=${format(asOnDate, "yyyy-MM-dd")}`,
          );
        }}
        sx={{ p: 2, height: "100%", alignItems: "flex-start" }}
      >
        <div>
          {renderCount()}
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {t(card.name)}
          </Typography>
        </div>
      </CardActionArea>
    </StyledTile>
  );
};

const MyDashboard = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const operationalModules = useSelector(
    (state) => state.dataEntry.metadata.operationalModules,
  );
  const [dashboards, setDashboards] = useState(null);
  const [error, setError] = useState(null);
  const [asOnDate, setAsOnDate] = useState(() => new Date());

  useEffect(() => {
    getDashboards()
      .then(setDashboards)
      .catch((loadError) =>
        setError(get(loadError, "message", "Could not load dashboards")),
      );
  }, []);

  if (!isNil(error))
    return (
      <StyledPaper>
        <Alert severity="error">{error}</Alert>
      </StyledPaper>
    );

  if (isNil(dashboards))
    return (
      <StyledPaper>
        <CircularProgress size={28} />
      </StyledPaper>
    );

  return (
    <Fragment>
      <Breadcrumbs path={location.pathname} />
      <StyledPaper sx={{ pb: 2 }}>
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <DatePicker
            label={t("asOnDate", "As on date")}
            value={asOnDate}
            format={dateFormat}
            onChange={(date) => !isNil(date) && setAsOnDate(date)}
            slotProps={{
              textField: {
                size: "small",
                sx: { width: { xs: "100%", sm: 220 } },
              },
              openPickerButton: {
                "aria-label": "change as on date",
                color: "primary",
              },
            }}
            closeOnSelect
          />
        </LocalizationProvider>
      </StyledPaper>
      {dashboards.map((dashboard) => (
        <StyledPaper key={dashboard.uuid}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t(dashboard.name)}
          </Typography>
          {sortBy(
            (dashboard.sections || []).filter((section) => !section.voided),
            "displayOrder",
          ).map((section) => {
            const cards = sortBy(
              (section.dashboardSectionCardMappings || []).filter(
                (mapping) => !mapping.voided && !isNil(mapping.card),
              ),
              "displayOrder",
            ).map((mapping) => mapping.card);
            if (isEmpty(cards)) return null;
            return (
              <div key={section.uuid} style={{ marginBottom: 24 }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  {t(section.name)}
                </Typography>
                <Grid container spacing={2}>
                  {cards.map((card) => (
                    <Grid key={card.uuid} size={{ xs: 6, sm: 4, md: 3 }}>
                      <ReportCardTile
                        card={card}
                        asOnDate={asOnDate}
                        operationalModules={operationalModules}
                      />
                    </Grid>
                  ))}
                </Grid>
              </div>
            );
          })}
        </StyledPaper>
      ))}
    </Fragment>
  );
};

export default MyDashboard;
