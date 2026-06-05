import { v4 as uuidv4 } from 'uuid';

export const termsTemplateCollectionName = 'termsTemplates';
export const termsCollectionName = 'terms';

export class TermsTemplate {
  constructor({
    id = `terms_${uuidv4()}`,
    name = '',
    description = '',
    content = '',
    category = '',
    createdAt = new Date(),
    updatedAt = new Date(),
  } = {}) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.content = content;
    this.category = category;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  toFirestore() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      content: this.content,
      category: this.category,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromFirestore(doc) {
    return new TermsTemplate({ id: doc.id, ...doc.data() });
  }
}

export class ContractTerm {
  constructor({ id = `term_${uuidv4()}`, description = '', text = '' } = {}) {
    this.id = id;
    this.description = description || text;
  }

  toFirestore() {
    return {
      id: this.id,
      description: this.description,
    };
  }

  static fromFirestore(doc) {
    return new ContractTerm({ id: doc.id, ...doc.data() });
  }
}

export const getTermDescription = (term) => term?.description || term?.text || '';

export const buildTermsContent = (template, terms = []) => {
  const content = template?.content?.trim();
  const termText = terms
    .map((term) => getTermDescription(term).trim())
    .filter(Boolean)
    .map((term, index) => `${index + 1}. ${term}`)
    .join('\n');

  return [content, termText].filter(Boolean).join('\n\n');
};
