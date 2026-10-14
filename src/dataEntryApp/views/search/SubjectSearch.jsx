import { useEffect } from "react";
import { Paper, Typography, Grid, Button, styled } from "@mui/material";
import { Cancel } from "@mui/icons-material";
import SubjectSearchTable from "dataEntryApp/views/search/SubjectSearchTable";
import { useTranslation } from "react-i18next";
import { useSelector, useDispatch } from "react-redux";
import { types } from "../../reducers/searchFilterReducer";
import { isEmpty } from "lodash";
import { getOrganisationConfig } from "../../reducers/metadataReducer";

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: "1.5rem",
  margin: "2rem 1rem",
  elevation: 2,
  [theme.breakpoints.down("sm")]: {
    padding: "0.75rem",
    margin: "0.5rem",
  },
}));

const StyledGrid = styled(Grid)({
  marginBottom: "1%",
  justifyContent: "space-between",
  alignItems: "baseline",
});

const StyledTypography = styled(Typography)(({ theme }) => ({
  fontSize: "22px",
  fontWeight: "500",
  float: "left",
  paddingTop: "1%",
  paddingLeft: "4px",
  [theme.breakpoints.down("sm")]: {
    fontSize: "18px",
    paddingLeft: 0,
  },
}));

const StyledButton = styled(Button)({
  color: "#212529",
});

const StyledCancel = styled(Cancel)({
  fontSize: "12px",
});

const SubjectSearch = () => {
  const dispatch = useDispatch();
  const searchRequest = useSelector(
    (state) => state.dataEntry.searchFilterReducer.request,
  );
  const organisationConfigs = useSelector(
    (state) => state.dataEntry.metadata.organisationConfigs,
  );

  useEffect(() => {
    if (!organisationConfigs) {
      dispatch(getOrganisationConfig());
    }
  }, [dispatch, organisationConfigs]);

  const { t } = useTranslation();
  const resetClick = () => {
    dispatch({
      type: types.ADD_SEARCH_REQUEST,
      value: { includeVoided: false },
    });
  };

  return (
    <StyledPaper>
      <StyledGrid container direction="row">
        <StyledTypography component="span">
          {!isEmpty(searchRequest.subjectType) ? t("searchResults") : ""}
        </StyledTypography>
        <StyledButton onClick={resetClick} aria-label="add an alarm">
          <StyledCancel /> {t("resetFilter")}
        </StyledButton>
      </StyledGrid>
      <SubjectSearchTable
        searchRequest={searchRequest}
        organisationConfigs={organisationConfigs}
      />
    </StyledPaper>
  );
};

export default SubjectSearch;
