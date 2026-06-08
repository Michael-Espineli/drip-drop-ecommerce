export class FeatureFlag {
  constructor({
    id,
    key,
    name = '',
    description = '',
    enabled = false,
    index = 0,
    createdAt = null,
    updatedAt = null,
  }) {
    this.id = id;
    this.key = key || id;
    this.name = name;
    this.description = description;
    this.enabled = Boolean(enabled);
    this.index = index;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static documentId(index) {
    return `feature_flag_${String(index).padStart(3, '0')}`;
  }

  static defaultName(index) {
    return (
      {
        1: 'iOS Messages',
        2: 'Company User Profile History',
        3: 'Management Technician Performance History',
        4: 'Sales',
        5: 'Turn on real emails',
        6: 'Payroll',
        8: 'Migration',
        9: 'Skimmer previous dosages upload',
      }[index] || ''
    );
  }

  static defaultDescription(index) {
    return (
      {
        1: 'Enables the iOS Messages experience.',
        2: 'Enables company user profile history views.',
        3: 'Enables management technician performance history.',
        4: 'Enables the Sales slice: dashboard, catalog items, service agreements, and sales billing workflows.',
        5: 'When off, service agreement and invoice emails are routed to the internal test inbox instead of homeowners.',
        6: 'Enables Payroll and Payroll Setup under company Finance.',
        8: 'Enables migration tooling for moving company CRM data into Drip Drop.',
        9: 'Enables the Skimmer previous dosages Excel upload inside migration tooling.',
      }[index] || ''
    );
  }

  static seedPayload(index, timestamp) {
    const id = FeatureFlag.documentId(index);

    return {
      id,
      key: id,
      name: FeatureFlag.defaultName(index),
      description: FeatureFlag.defaultDescription(index),
      enabled: false,
      index,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static fromFirestore(documentSnapshot) {
    return new FeatureFlag({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    });
  }
}
