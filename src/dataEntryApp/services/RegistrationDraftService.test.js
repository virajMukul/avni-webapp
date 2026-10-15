import {
  Concept,
  ConceptAnswer,
  Form,
  FormElement,
  FormElementGroup,
  Individual,
  Observation,
  QuestionGroup,
  SubjectType,
} from "openchs-models";
import { applyDraft, toDraft } from "./RegistrationDraftService";

const makeConcept = (name, datatype, answerNames = []) => {
  const concept = new Concept();
  concept.uuid = `concept-${name}`;
  concept.name = name;
  concept.datatype = datatype;
  concept.answers = answerNames.map((answerName, index) => {
    const conceptAnswer = new ConceptAnswer();
    conceptAnswer.uuid = `conceptAnswer-${answerName}`;
    conceptAnswer.answerOrder = index;
    conceptAnswer.concept = makeConcept(answerName, Concept.dataType.NA);
    return conceptAnswer;
  });
  return concept;
};

const makeObservation = (concept, value) => {
  const observation = new Observation();
  observation.concept = concept;
  observation.setValue(concept.getValueWrapperFor(value));
  return observation;
};

const makeForm = (concepts) => {
  const form = new Form();
  const formElementGroup = new FormElementGroup();
  formElementGroup.uuid = "feg-1";
  formElementGroup.formElements = concepts.map((concept, index) => {
    const formElement = new FormElement();
    formElement.uuid = `fe-${index}`;
    formElement.concept = concept;
    return formElement;
  });
  form.formElementGroups = [formElementGroup];
  return form;
};

const makeSubject = () => {
  const subject = Individual.createEmptySubjectInstance();
  const subjectType = new SubjectType();
  subjectType.uuid = "st-1";
  subjectType.name = "Person";
  subject.subjectType = subjectType;
  return subject;
};

const roundTrip = (concepts, observations) => {
  const subject = makeSubject();
  subject.observations = observations;
  const draft = JSON.parse(JSON.stringify(toDraft(subject)));
  const restored = applyDraft(makeSubject(), draft, makeForm(concepts));
  return { draft, restored };
};

describe("RegistrationDraftService", () => {
  it("round-trips flat answer types through a draft", () => {
    const text = makeConcept("Text", Concept.dataType.Text);
    const numeric = makeConcept("Weight", Concept.dataType.Numeric);
    const coded = makeConcept("Symptom", Concept.dataType.Coded, ["Fever", "Cough"]);

    const { restored } = roundTrip(
      [text, numeric, coded],
      [makeObservation(text, "hello"), makeObservation(numeric, 54.5), makeObservation(coded, ["concept-Fever"])],
    );

    expect(restored.observations).toHaveLength(3);
    expect(restored.observations[0].getValue()).toBe("hello");
    expect(restored.observations[1].getValue()).toBe(54.5);
    expect(restored.observations[2].getValue()).toEqual(["concept-Fever"]);
  });

  it("keeps question group children, which getValueWrapperFor alone would drop", () => {
    const childText = makeConcept("GroupText", Concept.dataType.Text);
    const group = makeConcept("Group", Concept.dataType.QuestionGroup);
    const groupObservation = new Observation();
    groupObservation.concept = group;
    groupObservation.setValue(new QuestionGroup([makeObservation(childText, "inside group")]));

    const { restored } = roundTrip([group, childText], [groupObservation]);

    expect(restored.observations).toHaveLength(1);
    const children = restored.observations[0].getValue();
    expect(children).toHaveLength(1);
    expect(children[0].concept.uuid).toBe("concept-GroupText");
    expect(children[0].getValue()).toBe("inside group");
  });

  it("drops observations whose concept is no longer on the form", () => {
    const text = makeConcept("Text", Concept.dataType.Text);
    const removed = makeConcept("Removed", Concept.dataType.Text);

    const subject = makeSubject();
    subject.observations = [makeObservation(text, "kept"), makeObservation(removed, "gone")];
    const draft = JSON.parse(JSON.stringify(toDraft(subject)));
    const restored = applyDraft(makeSubject(), draft, makeForm([text]));

    expect(restored.observations).toHaveLength(1);
    expect(restored.observations[0].getValue()).toBe("kept");
  });

  it("restores the person fields a registration starts with", () => {
    const subject = makeSubject();
    subject.firstName = "Asha";
    subject.lastName = "Devi";
    subject.dateOfBirth = new Date("1995-06-15T00:00:00.000Z");

    const draft = JSON.parse(JSON.stringify(toDraft(subject)));
    const restored = applyDraft(makeSubject(), draft, makeForm([]));

    expect(restored.firstName).toBe("Asha");
    expect(restored.lastName).toBe("Devi");
    expect(restored.dateOfBirth.toISOString()).toBe(subject.dateOfBirth.toISOString());
  });
});
