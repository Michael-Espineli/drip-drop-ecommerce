import React from 'react';

const shortDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  const year = date.getFullYear().toString().slice(-2);
  return `${month}/${day}/${year}`;
};

const PurchasesCardView = ({ item }) => {
  const totalAfterTax = item.totalAfterTax / 100;
  const price = item.price / 100;

  return (
    <div className="purchases-card-view">
      <div
        className="status-indicator"
        style={{
          backgroundColor: item.billable
            ? item.invoiced
              ? 'rgba(0, 128, 0, 0.5)' // Green for invoiced
              : 'rgba(255, 0, 0, 0.5)' // Red for not invoiced
            : 'rgba(255, 255, 0, 0.5)', // Yellow for not billable
        }}
      ></div>
      <div className="card-content">
        <div className="item-name">{item.name}</div>
        <div className="details-row">
          <div className="details-column">
            <div className="invoice-num">{item.invoiceNum}</div>
            <div className="date">{shortDate(item.date)}</div>
          </div>
          <div className="details-column">
            <div className="total">Total: ${totalAfterTax.toFixed(2)}</div>
            <div className="quantity-price">
              {item.quantityString} X ${price.toFixed(2)}
            </div>
          </div>
        </div>
        <div className="tech-customer-job">
          {item.techName && (
            <div className="tech-name">Tech: {item.techName}</div>
          )}
          {item.customerName && (
            <div className="customer-name">Customer: {item.customerName}</div>
          )}
          {item.jobId && <div className="job-id">Job: {item.jobId}</div>}
        </div>
      </div>
    </div>
  );
};

export default PurchasesCardView;